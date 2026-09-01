import { ChannelRef, channelTriggerAt, linkifyChannelRefs, matchChannels } from './channel-refs.util';

/**
 * `#channel` references: what counts as a trigger, what the typeahead
 * offers, and which handles become live references in a rendered body.
 */
describe('channel refs', () => {
    const channel = (slug: string | null, title: string): ChannelRef => ({ id: 'id-' + title, title, slug });

    const channels: ChannelRef[] = [
        channel('release-notes', 'Release Notes'),
        channel('qa-public-channel', 'QA Public Channel'),
        channel(null, '★ ★ ★'),
    ];

    describe('channelTriggerAt', () => {
        it('opens on a bare # so handles can be discovered', () => {
            expect(channelTriggerAt('see #')).toBe('');
        });

        it('captures the handle being typed', () => {
            expect(channelTriggerAt('see #release-no')).toBe('release-no');
        });

        it('triggers at the very start of the line', () => {
            expect(channelTriggerAt('#qa')).toBe('qa');
        });

        it('ignores a # that is not a handle', () => {
            // A heading, an issue number, a colour, a mid-word hash: none of
            // these are references, and popping a menu over them would fight
            // the person writing.
            expect(channelTriggerAt('# Heading')).toBeNull();
            expect(channelTriggerAt('see #1')).toBe('1'); // digits ARE valid handle chars
            expect(channelTriggerAt('#FF00AA')).toBeNull();
            expect(channelTriggerAt('a#b')).toBeNull();
        });

        it('closes once the handle is followed by a space', () => {
            expect(channelTriggerAt('see #release-notes ')).toBeNull();
        });

        it('has no trigger without a caret', () => {
            expect(channelTriggerAt(null)).toBeNull();
        });
    });

    describe('matchChannels', () => {
        it('offers every handled channel for an empty query', () => {
            expect(matchChannels(channels, '').map(c => c.slug)).toEqual(['release-notes', 'qa-public-channel']);
        });

        it('matches on the handle', () => {
            expect(matchChannels(channels, 'public').map(c => c.slug)).toEqual(['qa-public-channel']);
        });

        it('matches on the NAME too, so typing what you see works', () => {
            expect(matchChannels(channels, 'release n').map(c => c.slug)).toEqual(['release-notes']);
        });

        it('never offers a channel with no handle — there is nothing to cite', () => {
            expect(matchChannels(channels, '★').map(c => c.title)).toEqual([]);
        });

        it('caps the list', () => {
            const many = Array.from({ length: 20 }, (_, i) => channel('chan-' + i, 'Chan ' + i));
            expect(matchChannels(many, 'chan').length).toBe(8);
        });
    });

    describe('linkifyChannelRefs', () => {
        it('wraps a known handle', () => {
            expect(linkifyChannelRefs('<p>see #release-notes</p>', channels))
                .toBe('<p>see <span class="msg__chanref">#release-notes</span></p>');
        });

        it('leaves an UNKNOWN handle as plain text', () => {
            // A reference that looks live and goes nowhere is worse than one
            // that was never offered.
            expect(linkifyChannelRefs('<p>see #nope-not-a-channel</p>', channels))
                .toBe('<p>see #nope-not-a-channel</p>');
        });

        it('wraps a handle at the very start of the body and directly after a tag', () => {
            expect(linkifyChannelRefs('#release-notes', channels)).toContain('msg__chanref');
            expect(linkifyChannelRefs('<p>#release-notes</p>', channels)).toContain('msg__chanref');
        });

        it('does not wrap a handle glued to a word', () => {
            expect(linkifyChannelRefs('<p>a#release-notes</p>', channels)).toBe('<p>a#release-notes</p>');
        });

        it('wraps every occurrence', () => {
            const out = linkifyChannelRefs('<p>#release-notes and #qa-public-channel</p>', channels);
            expect((out.match(/msg__chanref/g) ?? []).length).toBe(2);
        });

        it('carries the handle in the TEXT, never a data attribute', () => {
            // Angular's sanitizer strips `data-*`, so a `data-chan` would arrive
            // as null and every click would silently do nothing.
            const out = linkifyChannelRefs('<p>#release-notes</p>', channels);
            expect(out).not.toContain('data-');
            expect(out).toContain('>#release-notes<');
        });

        it('is a no-op when no channel is known or no hash is present', () => {
            expect(linkifyChannelRefs('<p>#release-notes</p>', [])).toBe('<p>#release-notes</p>');
            expect(linkifyChannelRefs('<p>nothing here</p>', channels)).toBe('<p>nothing here</p>');
        });
    });
});
