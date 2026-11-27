// Result cards in chat: an icon, a title in the outcome's color, lines of text and any buttons.
import { MODULE_ID } from "../constants.mjs";

export const NOTE_TEMPLATE = `modules/${MODULE_ID}/templates/chat/note.hbs`;

/**
 * @typedef {object} NoteView
 * @property {string} icon
 * @property {string} title
 * @property {"success" | "failure" | ""} tone
 * @property {string[]} lines
 * @property {{ action: string, icon: string, label: string }[]} [buttons]
 * @property {string | null} [status]
 */

/** @param {NoteView} view */
export function noteContent(view) {
  return foundry.applications.handlebars.renderTemplate(NOTE_TEMPLATE, { buttons: [], status: null, ...view });
}

// Posts a result card spoken by the merchant.
/**
 * @param {any} merchant
 * @param {NoteView} view
 * @param {object} [message]
 */
export async function postNote(merchant, view, message = {}) {
  const content = await noteContent(view);
  return ChatMessage.create(/** @type {any} */ ({ speaker: ChatMessage.getSpeaker({ actor: merchant }), content, ...message }));
}
