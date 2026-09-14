/**
 * Server instructions sent in the initialize result (docs/SPEC.md §11.1).
 * Written for a spoken assistant: what the guard does and how to relay it.
 */
export const SERVER_INSTRUCTIONS = [
  "Housewarden manages a household. Before any change it returns a preview; changes marked needs_confirmation must be confirmed by the user via confirm_action or the console. Always read the preview aloud before confirming.",
  "Reads are free. Every tool that changes something returns either executed or needs_confirmation. When you get needs_confirmation, read the spoken line to the user, wait for an explicit yes, then call confirm_action with the action_id; if they say no, call reject_action. Never call confirm_action without the user's yes in this conversation. Some actions can only be approved in the console; say so. Use dry_run: true when the user asks what would happen. Refer to people, bills, chores and devices by name.",
].join("\n\n");
