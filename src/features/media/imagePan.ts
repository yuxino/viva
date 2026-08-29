interface Dimensions {
  height: number;
  width: number;
}

interface PanPosition {
  x: number;
  y: number;
}

export function constrainImagePan(
  pan: PanPosition,
  zoom: number,
  stage: Dimensions,
  image: Dimensions,
): PanPosition {
  if (zoom <= 1) return { x: 0, y: 0 };

  const maximumX = Math.max(0, (image.width * zoom - stage.width) / 2);
  const maximumY = Math.max(0, (image.height * zoom - stage.height) / 2);
  return {
    x: maximumX === 0 ? 0 : Math.max(-maximumX, Math.min(maximumX, pan.x)),
    y: maximumY === 0 ? 0 : Math.max(-maximumY, Math.min(maximumY, pan.y)),
  };
}
