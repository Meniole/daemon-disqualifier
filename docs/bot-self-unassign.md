# Bot Self-Unassign Feature

This feature allows bots to unassign themselves from GitHub issues when they cannot complete a task. This is particularly useful for testing scenarios and real-world cases where automated agents need to step down from assignments.

## Supported Commands

Bots can post any of the following comments to unassign themselves:

- `/unassign` - Simple slash command
- `/unassign me` - Explicit self-unassign command  
- `unassign me` - Natural language variant
- `I cannot complete this task` - Descriptive message for cases where the bot encounters limitations

## How It Works

1. **Comment Detection**: The daemon-disqualifier watches for comments on issues
2. **Bot Identification**: Only comments from users with `type: "Bot"` are processed for unassign commands
3. **Assignment Verification**: The bot must be currently assigned to the issue
4. **Unassignment Process**:
   - Posts a comment explaining the unassignment
   - Removes the bot from the issue assignees
   - Removes the issue from database tracking
   - Logs the action for audit purposes

## Example Usage

If Copilot bot is assigned to issue #39 and posts:
```
/unassign
```

The system will:
1. Verify Copilot is assigned to the issue
2. Post a comment: "@Copilot has unassigned themselves from this task."
3. Remove Copilot from the assignees list
4. Clean up internal tracking

## Security & Validation

- Only works for bots (`user.type === "Bot"`)
- Bots can only unassign themselves, not other assignees
- The bot must be currently assigned to the issue
- Invalid requests are logged and ignored

## Testing

The feature includes comprehensive tests covering:
- Valid unassign commands
- Invalid commands (human users, unassigned bots)
- Different command variations
- Proper API calls and database cleanup

## Related to Issue #39

This feature was implemented to address the "Bot un-assign" testing requirement in issue #39, allowing automated testing of bot unassignment scenarios.