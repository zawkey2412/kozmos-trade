// Window bases. Typed any because mixin return types are not in the generated types.
const { ApplicationV2, DocumentSheetV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** @type {new (options?: object) => any} */
export const HandlebarsApplication = HandlebarsApplicationMixin(ApplicationV2);

/** @type {new (options?: object) => any} */
export const HandlebarsDocumentSheet = HandlebarsApplicationMixin(DocumentSheetV2);
