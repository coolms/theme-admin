import { DialogRef } from '@angular/cdk/dialog';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { of } from 'rxjs';
import { ImageMapService } from '../image-maps/image-map.service';
import { ImageMapPickerComponent } from './image-map-picker.component';

/**
 * The image-map picker filters as the person types -- the same defect as the form picker's:
 * `filtered` was a computed over a plain field, so it never re-ran (the 2026-09-28 sweep).
 */
describe('ImageMapPickerComponent', () => {
    let fixture: ComponentFixture<ImageMapPickerComponent>;

    beforeEach(async () => {
        TestBed.configureTestingModule({
            imports: [ImageMapPickerComponent],
            providers: [
                {
                    provide: ImageMapService,
                    useValue: {
                        listImageMaps: () => of([
                            { slug: 'office-floor', title: 'Office floor', enabled: true, regions: [] },
                            { slug: 'warehouse', title: 'Warehouse', enabled: true, regions: [] },
                        ]),
                    },
                },
                { provide: DialogRef, useValue: { close: () => undefined } },
            ],
        });
        fixture = TestBed.createComponent(ImageMapPickerComponent);
        fixture.detectChanges();
        await fixture.whenStable();
    });

    const items = (): number => (fixture.nativeElement as HTMLElement).querySelectorAll('.imp__item').length;

    it('narrows the list to the maps that match what is typed', async () => {
        expect(items()).withContext('both maps before any filter').toBe(2);
        const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.imp__search')!;
        input.value = 'ware';
        input.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        fixture.detectChanges();
        expect(items()).toBe(1);
        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Warehouse');
    });
});
