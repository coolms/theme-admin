import { NO_NAME, SOMEONE, personInSentence, personLabel } from './person-label';

describe('personLabel', () => {
    it('is the name the person gave', () => {
        expect(personLabel('Ada Lovelace')).toBe('Ada Lovelace');
    });

    it('trims the name', () => {
        expect(personLabel('  Ada  ')).toBe('Ada');
    });

    it('is the neutral label for no name, an empty name or a blank one', () => {
        expect(NO_NAME).toBe('No name');
        expect(personLabel(null)).toBe('No name');
        expect(personLabel(undefined)).toBe('No name');
        expect(personLabel('')).toBe('No name');
        expect(personLabel('   ')).toBe('No name');
    });
});

describe('personInSentence', () => {
    it('is the name the person gave, trimmed', () => {
        expect(personInSentence('  Ada ')).toBe('Ada');
    });

    it('is "Someone" for no name, an empty name or a blank one', () => {
        expect(SOMEONE).toBe('Someone');
        expect(personInSentence(null)).toBe('Someone');
        expect(personInSentence(undefined)).toBe('Someone');
        expect(personInSentence('  ')).toBe('Someone');
    });
});
