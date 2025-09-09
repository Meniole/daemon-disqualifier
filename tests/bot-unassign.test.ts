import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { watchUserActivity } from "../src/handlers/watch-user-activity";
import { ContextPlugin } from "../src/types/plugin-input";

describe("Bot Self-Unassign", () => {
  const mockBotUser = {
    login: "test-bot",
    id: 12345,
    type: "Bot",
    avatar_url: "https://example.com/avatar.png",
    html_url: "https://github.com/test-bot",
    node_id: "BOT_test",
  };

  const mockIssue = {
    html_url: "https://github.com/test-org/test-repo/issues/42",
    assignees: [mockBotUser],
    assignee: mockBotUser,
    labels: [{ name: "Price: 10 USD" }],
    state: "open",
    number: 42,
  };

  const mockRemoveAssigneesFn = mock(() => Promise.resolve({ status: 200 }));
  const mockPostCommentFn = mock(() => Promise.resolve({ id: 123 }));
  const mockRemoveIssueFn = mock(() => Promise.resolve());

  const mockContext = {
    logger: new Logs("debug"),
    eventName: "issue_comment.created",
    payload: {
      repository: { 
        id: 123, 
        owner: { id: 123, login: "test-org" }, 
        name: "test-repo" 
      },
      issue: mockIssue,
      comment: {
        body: "/unassign",
        user: mockBotUser,
      },
    },
    config: {
      followUpInterval: 3600000,
      negligenceThreshold: 7200000,
      pullRequestRequired: true,
      availableDeadlineExtensions: {
        enabled: false,
        amounts: {},
      },
    },
    octokit: {
      rest: {
        issues: {
          removeAssignees: mockRemoveAssigneesFn,
        },
      },
    },
    commentHandler: {
      postComment: mockPostCommentFn,
    },
    adapters: {
      kv: {
        removeIssue: mockRemoveIssueFn,
      },
    },
  } as unknown as ContextPlugin;

  beforeEach(() => {
    mock.restore();
    mockRemoveAssigneesFn.mockClear();
    mockPostCommentFn.mockClear();
    mockRemoveIssueFn.mockClear();
  });

  it("should unassign a bot when it posts /unassign command", async () => {
    const result = await watchUserActivity(mockContext);
    
    expect(result.message).toBe("Bot self-unassigned successfully");
    expect(mockRemoveAssigneesFn).toHaveBeenCalledWith({
      owner: "test-org",
      repo: "test-repo",
      issue_number: 42,
      assignees: ["test-bot"],
    });
    expect(mockPostCommentFn).toHaveBeenCalled();
    expect(mockRemoveIssueFn).toHaveBeenCalledWith(mockIssue.html_url);
  });

  it("should unassign a bot when it posts /unassign me command", async () => {
    const contextWithUnassignMe = {
      ...mockContext,
      payload: {
        ...mockContext.payload,
        comment: {
          body: "/unassign me",
          user: mockBotUser,
        },
      },
    } as ContextPlugin;

    const result = await watchUserActivity(contextWithUnassignMe);
    
    expect(result.message).toBe("Bot self-unassigned successfully");
    expect(mockRemoveAssigneesFn).toHaveBeenCalled();
  });

  it("should unassign a bot when it posts unassign me command", async () => {
    const contextWithSimpleUnassign = {
      ...mockContext,
      payload: {
        ...mockContext.payload,
        comment: {
          body: "unassign me",
          user: mockBotUser,
        },
      },
    } as ContextPlugin;

    const result = await watchUserActivity(contextWithSimpleUnassign);
    
    expect(result.message).toBe("Bot self-unassigned successfully");
    expect(mockRemoveAssigneesFn).toHaveBeenCalled();
  });

  it("should not unassign bot if it's not assigned to the issue", async () => {
    const contextWithUnassignedBot = {
      ...mockContext,
      payload: {
        ...mockContext.payload,
        issue: {
          ...mockIssue,
          assignees: [], // Bot is not assigned
          assignee: null,
        },
      },
    } as ContextPlugin;

    const result = await watchUserActivity(contextWithUnassignedBot);
    
    expect(result.message).toContain("is not assigned");
    expect(mockRemoveAssigneesFn).not.toHaveBeenCalled();
    expect(mockPostCommentFn).not.toHaveBeenCalled();
  });

  it("should ignore unassign commands from human users", async () => {
    const humanUser = {
      login: "human-user",
      id: 67890,
      type: "User",
    };

    const contextWithHuman = {
      ...mockContext,
      payload: {
        ...mockContext.payload,
        comment: {
          body: "/unassign",
          user: humanUser,
        },
      },
    } as ContextPlugin;

    const result = await watchUserActivity(contextWithHuman);
    
    // Should fall through to the normal comment handling logic
    expect(result.message).toContain("not related to any daemon-disqualifier comment edit");
    expect(mockRemoveAssigneesFn).not.toHaveBeenCalled();
  });

  it("should detect 'I cannot complete this task' message", async () => {
    const contextWithCannotComplete = {
      ...mockContext,
      payload: {
        ...mockContext.payload,
        comment: {
          body: "I cannot complete this task",
          user: mockBotUser,
        },
      },
    } as ContextPlugin;

    const result = await watchUserActivity(contextWithCannotComplete);
    
    expect(result.message).toBe("Bot self-unassigned successfully");
    expect(mockRemoveAssigneesFn).toHaveBeenCalled();
  });
});