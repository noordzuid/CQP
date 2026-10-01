let canvasContainer;
let backgroundPicker;
let foregroundPicker;

function setup() {
  canvasContainer = document.querySelector("#canvas-container");
  backgroundPicker = document.querySelector("#bg-color");
  foregroundPicker = document.querySelector("#fg-color");

  const canvas = createCanvas(
    canvasContainer.clientWidth,
    canvasContainer.clientHeight,
  );
  canvas.parent(canvasContainer);

  noStroke();
}

function draw() {
  const x = constrain(mouseX, 0, width);
  const y = constrain(mouseY, 0, height);
  const color1 = backgroundPicker.value;
  const color2 = foregroundPicker.value;

  fill(color1);
  rect(0, 0, x, y);
  rect(x, y, width - x, height - y);

  fill(color2);
  rect(x, 0, width - x, y);
  rect(0, y, x, height - y);
}

function windowResized() {
  resizeCanvas(canvasContainer.clientWidth, canvasContainer.clientHeight);
}
