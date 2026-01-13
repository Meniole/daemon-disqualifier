import { RestEndpointMethodTypes } from "@octokit/rest";
import { updateCronState } from "../cron/workflow";
import { removeEntryFromDatabase } from "../helpers/remind-and-remove";
import { commentUpdateMetadataPattern } from "../helpers/structured-metadata";
import { getPriorityValue, parsePriceLabel } from "../helpers/task-metadata";
import { updateTaskReminder } from "../helpers/task-update";
import { parseIssueUrl } from "../helpers/github-url";
import { ContextPlugin } from "../types/plugin-input";
import { ListIssueForRepo } from "../types/github-types";
import { formatMillisecondsToHumanReadable } from "./time-format";

type IssueType = RestEndpointMethodTypes["issues"]["listForRepo"]["response"]["data"]["0"];

function isIssueComment(context: ContextPlugin): context is ContextPlugin<"issue_comment.edited"> {
  return "comment" in context.payload;
}

export async function watchUserActivity(context: ContextPlugin) {
  const { logger } = context;

  if (
    ["issues.assigned", "issues.reopened"].includes(context.eventName) &&
    "issue" in context.payload &&
    !shouldIgnoreIssue(context.payload.issue as IssueType)
  ) {
    const message = ["[!IMPORTANT]"];
    const priorityValue = getPriorityValue(context);
    if (context.config.pullRequestRequired) {
      message.push(`- Be sure to link a pull-request before the first reminder to avoid disqualification.`);
    }
    message.push(
      `- Reminders will be sent every \`${formatMillisecondsToHumanReadable(context.config.followUpInterval / priorityValue)}\` if there is no activity.`
    );
    message.push(
      `- Assignees will be disqualified after \`${formatMillisecondsToHumanReadable(context.config.negligenceThreshold / priorityValue)}\` of inactivity.`
    );
    const log = logger.error(message.map((o) => `> ${o}`).join("\n"));
    log.logMessage.diff = log.logMessage.raw;
    const commentData = await context.commentHandler.postComment(context, log);
    if (commentData) {
      await context.adapters.kv.addIssue(context.payload.issue.html_url, commentData.id);
    }
    await updateCronState(context);
    // We return early not to run the reminders section, which is handled by the CRON (avoids multiple reminders)
    return { message: "OK" };
  }

  if (isIssueComment(context)) {
    const commentBody = context.payload.comment.body;
    const commenter = context.payload.comment.user;
    
    // Check if this is a bot self-unassign command
    if (commenter?.type === "Bot" && isBotUnassignCommand(commentBody)) {
      const issue = context.payload.issue;
      const isAssigned = issue.assignees?.some(assignee => assignee?.id === commenter.id);
      
      if (isAssigned) {
        logger.info(`Bot ${commenter.login} requested self-unassignment from ${issue.html_url}`);
        await handleBotSelfUnassign(context, issue as ListIssueForRepo, commenter);
        return { message: "Bot self-unassigned successfully" };
      } else {
        return { message: logger.warn(`Bot ${commenter.login} is not assigned to ${issue.html_url}, ignoring unassign request.`).logMessage.raw };
      }
    }
    
    if (commentUpdateMetadataPattern.test(commentBody)) {
      const repo = context.payload.repository;
      logger.debug(`> Watching user activity for repo: ${repo.name} (${repo.html_url})`);
      await updateReminders(context, repo);
      await updateCronState(context);
      return { message: "OK" };
    } else {
      return { message: logger.warn("The comment is not related to any daemon-disqualifier comment edit.").logMessage.raw };
    }
  }
  return { message: logger.warn(`Unsupported event ${context.eventName}`).logMessage.raw };
}

/*
 * We ignore the issue if:
 * - draft
 * - pull request
 * - locked
 * - not in "open" state
 * - not priced (no price label found)
 */
function shouldIgnoreIssue(issue: IssueType) {
  return issue.draft || !!issue.pull_request || issue.locked || issue.state !== "open" || parsePriceLabel(issue.labels) === null;
}

async function updateReminders(context: ContextPlugin, repo: ContextPlugin["payload"]["repository"]) {
  const { logger, octokit, payload } = context;
  const owner = payload.repository.owner?.login;
  if (!owner) {
    throw new Error("No owner found in the payload");
  }
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner,
    repo: repo.name,
    per_page: 100,
    state: "open",
  });

  // We use a for of loop instead of a promise to actually give some delay between updates. It helps not reach API
  // limits and concurrency when committing the updated DB
  for (const issue of issues) {
    if (shouldIgnoreIssue(issue)) {
      logger.info(`Skipping issue ${issue.html_url} due to the issue not meeting the right criteria.`, {
        draft: issue.draft,
        pullRequest: !!issue.pull_request,
        locked: issue.locked,
        state: issue.state,
        priceLabel: parsePriceLabel(issue.labels),
      });
      continue;
    }

    if (issue.assignees?.length || issue.assignee) {
      logger.debug(`Checking assigned issue: ${issue.html_url}`);
      await updateTaskReminder(context, repo, issue);
    } else {
      logger.info(`Skipping issue ${issue.html_url} because no user is assigned.`);
      await removeEntryFromDatabase(context, issue);
    }
  }
}

/**
 * Detects if a comment contains a bot self-unassign command
 */
function isBotUnassignCommand(commentBody: string): boolean {
  const unassignPatterns = [
    /^\/unassign\s*$/i,
    /^\/unassign me\s*$/i,
    /^@\w*\s+unassign me\s*$/i,
    /^I cannot complete this task/i,
    /^unassign me/i
  ];
  
  return unassignPatterns.some(pattern => pattern.test(commentBody.trim()));
}

/**
 * Handles bot self-unassignment from an issue
 */
async function handleBotSelfUnassign(
  context: ContextPlugin, 
  issue: ListIssueForRepo, 
  botUser: { login: string; id: number }
) {
  const { octokit, logger, commentHandler } = context;
  const { repo, owner, issue_number } = parseIssueUrl(issue.html_url);

  // Create a log message for the unassignment
  const logMessage = logger.info(
    `@${botUser.login} has unassigned themselves from this task.`,
    {
      issue: issue.html_url,
      botId: botUser.id,
      reason: "self-requested"
    }
  );

  // Post a comment about the unassignment
  await commentHandler.postComment(
    {
      ...context,
      payload: {
        ...context.payload,
        issue,
        repository: {
          owner: {
            login: owner,
          },
          name: repo,
        },
      },
    } as ContextPlugin,
    logMessage,
    { raw: true, updateComment: false }
  );

  // Remove the bot from assignees
  await octokit.rest.issues.removeAssignees({
    owner,
    repo,
    issue_number,
    assignees: [botUser.login],
  });

  // Remove from database tracking
  await removeEntryFromDatabase(context, issue);

  logger.info(`Successfully removed bot ${botUser.login} from issue ${issue.html_url}`);
}
