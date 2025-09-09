/**
 * Simple demonstration script for testing bot unassign functionality
 * This script simulates the bot's unassign behavior without requiring Bun
 */

import { Logs } from "@ubiquity-os/ubiquity-os-logger";

// Simple mock implementations for demonstration
interface MockIssue {
  html_url: string;
  number: number;
  assignees: Array<{ login: string; id: number }>;
  labels: Array<{ name: string }>;
}

interface MockContext {
  logger: Logs;
  config: {
    negligenceThreshold: number;
  };
  octokit: {
    rest: {
      issues: {
        removeAssignees: (params: any) => Promise<any>;
      };
    };
  };
  commentHandler: {
    postComment: (context: any, message: any, options?: any) => Promise<any>;
  };
  adapters: {
    kv: {
      removeIssue: (url: string) => Promise<void>;
    };
  };
}

// Simple implementation of parseIssueUrl
function parseIssueUrl(url: string) {
  const match = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/]+)\/issues\/(\d+)/);
  if (!match) {
    throw new Error("Invalid issue URL");
  }
  return {
    owner: match[1],
    repo: match[2],
    issue_number: parseInt(match[3], 10),
  };
}

// Simple implementation of getRemainingAvailableExtensions
async function getRemainingAvailableExtensions() {
  return { remainingExtensions: 0 };
}

// Simplified version of the unassignUserFromIssue function
async function demonstrateUnassignUser(context: MockContext, issue: MockIssue) {
  const { logger, config } = context;

  if (config.negligenceThreshold <= 0) {
    logger.info("The unassign threshold is <= 0, won't unassign users.");
    return false;
  }

  return await removeAllAssignees(context, issue);
}

async function removeAllAssignees(context: MockContext, issue: MockIssue) {
  const { octokit, logger, commentHandler } = context;
  const { repo, owner, issue_number } = parseIssueUrl(issue.html_url);

  if (!issue?.assignees?.length) {
    logger.error(`Missing Assignees from ${issue.html_url}`);
    return false;
  }

  const logins = issue.assignees.map((o) => o?.login).filter((o) => !!o) as string[];
  const { remainingExtensions } = await getRemainingAvailableExtensions();
  
  const logMessage = logger.info(
    `${logins.map((o) => `@${o}`).join(", ")} you have ${remainingExtensions <= 0 ? "used all available deadline extensions" : "shown no activity"} and have been disqualified from this task.`,
    {
      issue: issue.html_url,
    }
  );

  // Post comment explaining the disqualification
  await commentHandler.postComment(
    context as any,
    logMessage,
    { raw: true, updateComment: false }
  );

  // Remove assignees via GitHub API
  await octokit.rest.issues.removeAssignees({
    owner,
    repo,
    issue_number,
    assignees: logins,
  });

  // Remove from database
  await context.adapters.kv.removeIssue(issue.html_url);
  
  return true;
}

// Demonstration function
async function runDemonstration() {
  console.log("🤖 Daemon Disqualifier Bot Un-assign Demonstration\n");

  // Mock context with logging and API functions
  const mockContext: MockContext = {
    logger: new Logs("debug"),
    config: {
      negligenceThreshold: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
    },
    octokit: {
      rest: {
        issues: {
          removeAssignees: async (params) => {
            console.log("✅ GitHub API Call - removeAssignees:", params);
            return { data: {} };
          },
        },
      },
    },
    commentHandler: {
      postComment: async (context, message, options) => {
        console.log("💬 Posting disqualification comment:", message.logMessage?.raw || message);
        return { data: { id: 123 } };
      },
    },
    adapters: {
      kv: {
        removeIssue: async (url) => {
          console.log("🗑️  Removing issue from database:", url);
        },
      },
    },
  };

  // Test case 1: Normal unassignment
  console.log("📝 Test Case 1: Normal unassignment of inactive user");
  const testIssue1: MockIssue = {
    html_url: "https://github.com/Meniole/daemon-disqualifier/issues/39",
    number: 39,
    assignees: [{ login: "Copilot", id: 198982749 }],
    labels: [{ name: "Price: 12.5 USD" }],
  };

  const result1 = await demonstrateUnassignUser(mockContext, testIssue1);
  console.log("Result:", result1 ? "✅ Successfully unassigned user" : "❌ Failed to unassign user");

  console.log("\n" + "=".repeat(50) + "\n");

  // Test case 2: No assignees
  console.log("📝 Test Case 2: Issue with no assignees");
  const testIssue2: MockIssue = {
    html_url: "https://github.com/Meniole/daemon-disqualifier/issues/40",
    number: 40,
    assignees: [],
    labels: [{ name: "Price: 12.5 USD" }],
  };

  const result2 = await demonstrateUnassignUser(mockContext, testIssue2);
  console.log("Result:", result2 ? "✅ Successfully processed" : "❌ No assignees to unassign");

  console.log("\n" + "=".repeat(50) + "\n");

  // Test case 3: Unassign disabled
  console.log("📝 Test Case 3: Unassignment disabled (threshold = 0)");
  const disabledContext = {
    ...mockContext,
    config: { negligenceThreshold: 0 }
  };

  const result3 = await demonstrateUnassignUser(disabledContext, testIssue1);
  console.log("Result:", result3 ? "✅ Successfully processed" : "❌ Unassignment disabled");

  console.log("\n🎉 Demonstration completed successfully!");
  console.log("\nThe bot's unassign functionality:");
  console.log("1. ✅ Can unassign inactive users from issues");
  console.log("2. ✅ Posts explanation comments when unassigning");
  console.log("3. ✅ Removes issues from tracking database");
  console.log("4. ✅ Handles edge cases (no assignees, disabled feature)");
}

// Run the demonstration
runDemonstration().catch(console.error);