import { Logs } from "@ubiquity-os/ubiquity-os-logger";
import { beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { unassignUserFromIssue } from "../src/helpers/remind-and-remove";
import { ListIssueForRepo } from "../src/types/github-types";
import { ContextPlugin } from "../src/types/plugin-input";

describe("Bot Un-assign tests", () => {
  beforeEach(() => {
    mock.restore();
    mock.clearAllMocks();
  });

  it("Should successfully unassign a user from an issue", async () => {
    // Mock the removeAssignees API call
    const removeAssigneesMock = mock(() => Promise.resolve({ data: {} }));
    const postCommentMock = mock(() => Promise.resolve({ data: { id: 123 } }));
    const removeIssueMock = mock(() => Promise.resolve());

    const mockContext = {
      logger: new Logs("debug"),
      config: {
        negligenceThreshold: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
      },
      octokit: {
        rest: {
          issues: {
            removeAssignees: removeAssigneesMock,
            createComment: postCommentMock,
          },
        },
      },
      commentHandler: {
        postComment: postCommentMock,
      },
      adapters: {
        kv: {
          removeIssue: removeIssueMock,
        },
      },
    } as unknown as ContextPlugin;

    const mockIssue = {
      html_url: "https://github.com/test/repo/issues/1",
      number: 1,
      assignees: [{ login: "testuser", id: 12345 }],
      labels: [],
    } as unknown as ListIssueForRepo;

    // Mock the getRemainingAvailableExtensions function
    spyOn(await import("../src/helpers/deadline-extensions"), "getRemainingAvailableExtensions").mockReturnValue(
      Promise.resolve({ remainingExtensions: 0 })
    );

    // Mock the parseIssueUrl function
    spyOn(await import("../src/helpers/github-url"), "parseIssueUrl").mockReturnValue({
      owner: "test",
      repo: "repo", 
      issue_number: 1
    });

    const loggerInfoSpy = spyOn(mockContext.logger, "info");

    // Execute the unassign function
    await unassignUserFromIssue(mockContext, mockIssue);

    // Verify that the assignee was removed via API
    expect(removeAssigneesMock).toHaveBeenCalledWith({
      owner: "test",
      repo: "repo",
      issue_number: 1,
      assignees: ["testuser"],
    });

    // Verify that a disqualification comment was posted
    expect(postCommentMock).toHaveBeenCalled();

    // Verify that the issue was removed from the database
    expect(removeIssueMock).toHaveBeenCalledWith("https://github.com/test/repo/issues/1");

    // Verify that the proper log message was created
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.stringContaining("@testuser you have"),
      expect.objectContaining({
        issue: "https://github.com/test/repo/issues/1",
      })
    );
  });

  it("Should handle case with no assignees gracefully", async () => {
    const removeAssigneesMock = mock(() => Promise.resolve({ data: {} }));
    
    const mockContext = {
      logger: new Logs("debug"),
      config: {
        negligenceThreshold: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
      },
      octokit: {
        rest: {
          issues: {
            removeAssignees: removeAssigneesMock,
          },
        },
      },
    } as unknown as ContextPlugin;

    const mockIssue = {
      html_url: "https://github.com/test/repo/issues/1",
      number: 1,
      assignees: [], // No assignees
    } as unknown as ListIssueForRepo;

    const loggerErrorSpy = spyOn(mockContext.logger, "error");

    // Execute the unassign function
    const result = await unassignUserFromIssue(mockContext, mockIssue);

    // Verify that the function returns false when there are no assignees
    expect(result).toBe(undefined);

    // Verify that no API calls were made since there are no assignees
    expect(removeAssigneesMock).not.toHaveBeenCalled();
  });

  it("Should not unassign when negligenceThreshold is 0", async () => {
    const removeAssigneesMock = mock(() => Promise.resolve({ data: {} }));
    
    const mockContext = {
      logger: new Logs("debug"),
      config: {
        negligenceThreshold: 0, // Disabled
      },
      octokit: {
        rest: {
          issues: {
            removeAssignees: removeAssigneesMock,
          },
        },
      },
    } as unknown as ContextPlugin;

    const mockIssue = {
      html_url: "https://github.com/test/repo/issues/1",
      number: 1,
      assignees: [{ login: "testuser", id: 12345 }],
    } as unknown as ListIssueForRepo;

    const loggerInfoSpy = spyOn(mockContext.logger, "info");

    // Execute the unassign function
    await unassignUserFromIssue(mockContext, mockIssue);

    // Verify that no API calls were made
    expect(removeAssigneesMock).not.toHaveBeenCalled();

    // Verify that the appropriate log message was created
    expect(loggerInfoSpy).toHaveBeenCalledWith("The unassign threshold is <= 0, won't unassign users.");
  });
});