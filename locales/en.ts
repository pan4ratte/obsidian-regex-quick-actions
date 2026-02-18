export default {
    /* Section headers */

    PLUGIN_SETTINGS_HEADER: "Regex Quick Actions settings",
    MANAGE_SECTION_HEADER: "Manage quick actions",
    GENERAL_SECTION_HEADER: "General",
    PLUGIN_DESC: "This plugin allows you to create and quickly apply regex actions via: the command palette (any action), the file explorer context menu (default action), the file context menu (default action). Every saved action becomes a palette command, which ensures automatisation possibilities.",
    
    /* Generic buttons, use when needed */
    
    ADD: "Add",
    SAVE: "Save",
    CANCEL: "Cancel",
    YES: "Yes",
    EDIT: "Edit",
    DELETE: "Delete",
    
    /* Dialogs */

    DELETE_HEADER: "Delete quick action",
    DELETE_CONFIRM: "Are you sure you want to delete quick action \"{}\"?",
    FOLDER_ACTION_CONFIRM_TITLE: "Confirm action",
    FOLDER_ACTION_CONFIRM_MSG: "Are you sure that you want to run default quick action on every file inside this folder? This action is irreversible.",

    /* Descriptions */

    PLACEHOLDER_NAME: "Used to call quick actions via command palette",
    PLACEHOLDER_SEARCH: "Search pattern",
    PLACEHOLDER_FLAGS: "e.g. gm",
    PLACEHOLDER_REPLACEMENT: "Replacement text",
    ADD_QUICK_ACTION: "New quick action",
    ACTION_NAME: "Quick action name",
    SEARCH_REGEX: "Regex rule",
    FLAGS: "Flags",
    REPLACEMENT: "Replacement",
    SET_AS_DEFAULT: "Set as default quick action",
    RUN_DEFAULT: "Run default quick action",
    RUN_DEFAULT_ON_FOLDER: "Run default quick action on folder",
    CONFIRM_FOLDER_ACTION: "Confirmation for quick action on folder",
    CONFIRM_FOLDER_ACTION_DESC: "Show a confirmation dialog before running quick action on every file inside a chosen folder.",

    /* Errors and messages */

    NAME_EMPTY_ERR: "Error: Quick action name cannot be empty!",
    NAME_EXISTS_ERR: "Error: An action with this name already exists!",
    PATTERN_EMPTY_ERR: "Error: Regex pattern cannot be empty!",
    FLAGS_INVALID_ERR: "Error: Invalid regex flags provided!",
    REGEX_INVALID_ERR: "Error: Invalid regular expression syntax!",
    NOT_FOUND_ERR: " not found!",
    EXECUTED_MSG: "Executed '{}' with {} replacements."
};