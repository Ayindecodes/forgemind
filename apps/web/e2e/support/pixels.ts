import type { Page } from '@playwright/test';

export async function readPixels(page: Page, testId: string) {
  const screenshot = await page.getByTestId(testId).screenshot();

  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    context?.drawImage(image, 0, 0);

    return {
      width: image.width,
      data: [
        ...(context?.getImageData(0, 0, image.width, image.height).data ?? []),
      ],
    };
  }, screenshot.toString('base64'));
}
