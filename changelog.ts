import { App, Component, MarkdownRenderer, Modal, moment, setIcon, setTooltip } from 'obsidian';

import { t } from './i18n';
// Bundled into main.js as text; see rollup.config.js.
import changelogEn from './CHANGELOG.md';
import changelogRu from './CHANGELOG_RU.md';

// Borrowed from the Tags Color Files plugin, so the plugins' changelogs look alike.

/** Changelogs by interface language; any other falls back to English. */
const CHANGELOGS: Record<string, string> = {
    ru: changelogRu,
};

/** A regional locale such as "zh-cn" also tries its base language. */
function changelogContent(): string {
    const lang = moment.locale();
    return CHANGELOGS[lang] ?? CHANGELOGS[lang.split('-')[0]] ?? changelogEn;
}

/** The changelog, rendered as markdown. */
export class ChangelogModal extends Modal {
    // Owns the renderer's children, so they are unloaded with the modal.
    private readonly renderComponent = new Component();

    constructor(app: App) {
        super(app);
    }

    onOpen() {
        const { contentEl } = this;
        // Not `markdown-rendered`: its note-sized fonts would override styles.css.
        contentEl.addClass('orp-markdown-modal');
        this.renderComponent.load();
        void MarkdownRenderer.render(this.app, changelogContent(), contentEl, '', this.renderComponent);
    }

    onClose() {
        this.renderComponent.unload();
        this.contentEl.empty();
    }
}

export interface ChangelogNoticeOptions {
    app: App;
    /** The running release, which is also what dismissing remembers. */
    version: string;
    /** The release whose notice was dismissed. */
    dismissedVersion: string;
    onDismiss(): void;
}

/** The "what's new" card at the head of the settings, shown until dismissed. */
export function renderChangelogNotice(parent: HTMLElement, options: ChangelogNoticeOptions): void {
    if (options.dismissedVersion === options.version) return;

    const card = parent.createDiv({ cls: 'orp-changelog-notice' });
    const message = card.createDiv({ cls: 'orp-changelog-message' });
    setIcon(message.createSpan({ cls: 'orp-changelog-icon' }), 'sparkles');
    message.createSpan({
        cls: 'orp-changelog-notice-text',
        text: t('CHANGELOG_UPDATED', options.version),
    });
    // One wrapper, so on a narrow pane both buttons wrap under the text together.
    const actions = card.createDiv({ cls: 'orp-changelog-actions' });
    const openBtn = actions.createEl('button', {
        cls: 'orp-changelog-open',
        text: t('CHANGELOG_SEE_WHATS_NEW'),
    });
    openBtn.addEventListener('click', () => new ChangelogModal(options.app).open());

    const dismiss = actions.createEl('button', {
        cls: 'orp-changelog-dismiss',
        text: t('CHANGELOG_DISMISS'),
    });
    setTooltip(dismiss, t('CHANGELOG_DISMISS_TOOLTIP'));

    // Centers the text once the buttons have wrapped. Measured, since where they wrap
    // depends on the translated labels.
    const stacking = new ResizeObserver(() => {
        card.toggleClass(
            'is-stacked',
            actions.offsetTop >= message.offsetTop + message.offsetHeight,
        );
    });
    stacking.observe(card);

    dismiss.addEventListener('click', () => {
        stacking.disconnect();
        options.onDismiss();
        if (card.win.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            card.remove();
            return;
        }
        // Collapses the card, so the settings below slide up instead of jumping.
        const style = card.win.getComputedStyle(card);
        const animation = card.animate(
            {
                height: [`${card.getBoundingClientRect().height}px`, '0px'],
                marginBottom: [style.marginBottom, '0px'],
                opacity: [1, 0],
            },
            { duration: 180, easing: 'ease-in-out' },
        );
        animation.onfinish = () => card.remove();
    });
}
