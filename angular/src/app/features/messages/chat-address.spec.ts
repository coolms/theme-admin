import { UrlSegment } from '@angular/router';

import { chatCommands, chatPageMatcher, CONVERSATION_PARAM } from './chat-address';

const seg = (path: string): UrlSegment => new UrlSegment(path, {});

/** One route for the chat page: `/chat` the list alone, `/chat/<id>` that conversation; nothing deeper. */
describe('the chat page address', () => {
    it('matches the list alone, consuming nothing', () => {
        expect(chatPageMatcher([])).toEqual({ consumed: [] });
    });

    it('matches one conversation, naming it', () => {
        const id = seg('0190a5e2-7c1d-7000-8000-000000000001');
        const match = chatPageMatcher([id]);
        expect(match?.consumed).toEqual([id]);
        expect(match?.posParams?.[CONVERSATION_PARAM]?.path).toBe('0190a5e2-7c1d-7000-8000-000000000001');
    });

    it('does not match deeper paths', () => {
        expect(chatPageMatcher([seg('a'), seg('b')])).toBeNull();
    });

    it('builds the commands for each', () => {
        expect(chatCommands('c1')).toEqual(['/chat', 'c1']);
        expect(chatCommands(null)).toEqual(['/chat']);
    });
});
