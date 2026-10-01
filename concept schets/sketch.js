let canvasContainer;
let canvasRenderer;
let backgroundPicker;
let foregroundPicker;
let widthSlider;
let heightSlider;
let widthValue;
let heightValue;
let keyframeList;
let canvasWidthInput;
let canvasHeightInput;
let durationInput;
let removeKeyframeButton;
let playPauseButton;
let exportButton;

let splitX = 50;
let splitY = 50;
let isDragging = false;
let isAnimating = false;
let isPaused = false;
let animationElapsed = 0;
let animationLastTime = 0;
let selectedKeyframe = 0;
let keyframes = [{ x: splitX, y: splitY, duration: 1 }];

let exportRecorder = null;
let exportChunks = [];
let cancelExport = false;

const HEX_PATTERN = /^#[0-9A-F]{6}$/i;

function setup() {
  canvasContainer = document.querySelector("#canvas-container");
  backgroundPicker = document.querySelector("#bg-color");
  foregroundPicker = document.querySelector("#fg-color");
  widthSlider = document.querySelector("#rect-width");
  heightSlider = document.querySelector("#rect-height");
  widthValue = document.querySelector("#width-value");
  heightValue = document.querySelector("#height-value");
  keyframeList = document.querySelector("#keyframe-list");
  canvasWidthInput = document.querySelector("#canvas-width");
  canvasHeightInput = document.querySelector("#canvas-height");
  durationInput = document.querySelector("#keyframe-duration");
  removeKeyframeButton = document.querySelector("#remove-keyframe");
  playPauseButton = document.querySelector("#toggle-animation");
  exportButton = document.querySelector("#export-animation");

  canvasWidthInput.value = 1920;
  canvasHeightInput.value = 1080;

  pixelDensity(1);
  canvasRenderer = createCanvas(
    Number(canvasWidthInput.value),
    Number(canvasHeightInput.value),
  );
  canvasRenderer.parent(canvasContainer);
  fitCanvasToContainer();

  noStroke();
  setupHexInput(backgroundPicker);
  setupHexInput(foregroundPicker);

  widthSlider.addEventListener("input", () => {
    stopAnimation();
    setPosition(Number(widthSlider.value), splitY);
    updateSelectedKeyframe();
  });

  heightSlider.addEventListener("input", () => {
    stopAnimation();
    setPosition(splitX, Number(heightSlider.value));
    updateSelectedKeyframe();
  });

  removeKeyframeButton.addEventListener("click", removeSelectedKeyframe);
  document.querySelector("#duplicate-keyframe").addEventListener("click", duplicateSelectedKeyframe);
  playPauseButton.addEventListener("click", togglePlayback);
  exportButton.addEventListener("click", exportAnimation);
  canvasWidthInput.addEventListener("change", updateCanvasSize);
  canvasHeightInput.addEventListener("change", updateCanvasSize);
  durationInput.addEventListener("change", updateSelectedKeyframeDuration);

  renderKeyframes();
}

function draw() {
  updateAnimation();

  const x = Math.round((splitX / 100) * width);
  const y = Math.round((splitY / 100) * height);
  const color1 = getHexColor(backgroundPicker);
  const color2 = getHexColor(foregroundPicker);

  fill(color1);
  rect(0, 0, x, y);
  rect(x, y, width - x, height - y);

  fill(color2);
  rect(x, 0, width - x, y);
  rect(0, y, x, height - y);

  cursor(isDragging ? "grabbing" : "grab");
}

function setupHexInput(input) {
  input.value = input.value.toUpperCase();
  input.dataset.lastValid = input.value;

  input.addEventListener("input", () => {
    let value = input.value.trim().toUpperCase();
    if (/^[0-9A-F]{6}$/.test(value)) value = `#${value}`;

    input.value = value;
    if (HEX_PATTERN.test(value)) input.dataset.lastValid = value;
  });

  const normalize = () => {
    let value = input.value.trim().toUpperCase();
    if (/^[0-9A-F]{6}$/.test(value)) value = `#${value}`;

    input.value = HEX_PATTERN.test(value)
      ? value
      : input.dataset.lastValid;
    input.dataset.lastValid = input.value;
  };

  input.addEventListener("change", normalize);
  input.addEventListener("blur", normalize);
}

function getHexColor(input) {
  const value = input.value.trim();
  return HEX_PATTERN.test(value) ? value : input.dataset.lastValid;
}

function mousePressed() {
  const isInsideCanvas =
    mouseX >= 0 && mouseX <= width &&
    mouseY >= 0 && mouseY <= height;

  if (isInsideCanvas) {
    stopAnimation();
    isDragging = true;
    updatePositionFromMouse();
    return false;
  }
}

function mouseDragged() {
  if (isDragging) {
    updatePositionFromMouse();
    return false;
  }
}

function mouseReleased() {
  isDragging = false;
}

function windowResized() {
  fitCanvasToContainer();
}

function updatePositionFromMouse() {
  const x = (constrain(mouseX, 0, width) / width) * 100;
  const y = (constrain(mouseY, 0, height) / height) * 100;
  setPosition(x, y);
  updateSelectedKeyframe();
}

function setPosition(x, y) {
  splitX = constrain(x, 0, 100);
  splitY = constrain(y, 0, 100);

  widthSlider.value = splitX;
  heightSlider.value = splitY;
  widthValue.textContent = `${Math.round(splitX)}%`;
  heightValue.textContent = `${Math.round(splitY)}%`;
}

function updateSelectedKeyframe() {
  if (selectedKeyframe < 0) return;

  keyframes[selectedKeyframe] = {
    ...keyframes[selectedKeyframe],
    x: splitX,
    y: splitY,
  };
  renderKeyframes();
}

function updateSelectedKeyframeDuration() {
  if (selectedKeyframe < 0) return;

  const duration = Math.max(0.1, Number(durationInput.value) || 1);
  keyframes[selectedKeyframe].duration = duration;
  durationInput.value = duration;
  renderKeyframes();
}

function selectKeyframe(index) {
  stopAnimation();
  selectedKeyframe = index;
  const keyframe = keyframes[index];
  setPosition(keyframe.x, keyframe.y);
  durationInput.value = keyframe.duration;
  renderKeyframes();
}

function duplicateSelectedKeyframe() {
  stopAnimation();

  const source = selectedKeyframe >= 0
    ? keyframes[selectedKeyframe]
    : { x: splitX, y: splitY };
  const insertAt = selectedKeyframe >= 0
    ? selectedKeyframe + 1
    : keyframes.length;

  keyframes.splice(insertAt, 0, { ...source });
  selectedKeyframe = insertAt;
  setPosition(source.x, source.y);
  durationInput.value = source.duration;
  renderKeyframes();
}

function removeSelectedKeyframe() {
  stopAnimation();

  if (selectedKeyframe < 0 || keyframes.length === 1) return;

  const removedIndex = selectedKeyframe;
  keyframes.splice(removedIndex, 1);
  selectedKeyframe = Math.min(removedIndex, keyframes.length - 1);

  const keyframe = keyframes[selectedKeyframe];
  setPosition(keyframe.x, keyframe.y);
  durationInput.value = keyframe.duration;
  renderKeyframes();
}

function renderKeyframes() {
  keyframeList.replaceChildren();

  keyframes.forEach((keyframe, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "keyframe-button";
    button.classList.toggle("selected", index === selectedKeyframe);
    button.textContent = `${index + 1} · ${Math.round(keyframe.x)}×${Math.round(keyframe.y)} · ${formatDuration(keyframe.duration)}s`;
    button.title = `Keyframe ${index + 1}: ${Math.round(keyframe.x)}% × ${Math.round(keyframe.y)}%, ${formatDuration(keyframe.duration)} seconden`;
    button.addEventListener("click", () => selectKeyframe(index));
    keyframeList.append(button);
  });

  updateControlAvailability();
}

function updateControlAvailability() {
  const isExporting = exportRecorder !== null;
  removeKeyframeButton.disabled = selectedKeyframe < 0 || keyframes.length === 1;
  durationInput.disabled = selectedKeyframe < 0 || isExporting;
  playPauseButton.disabled = keyframes.length < 2 || isExporting;
  exportButton.disabled = keyframes.length < 2 || isExporting;
}

function togglePlayback() {
  if (keyframes.length < 2) return;

  if (isAnimating) {
    isAnimating = false;
    isPaused = true;
    updatePlayPauseButton();
    return;
  }

  if (isPaused) {
    isAnimating = true;
    isPaused = false;
    animationLastTime = millis();
    updatePlayPauseButton();
    return;
  }

  startAnimation();
}

function startAnimation() {
  selectedKeyframe = -1;
  animationElapsed = 0;
  animationLastTime = millis();
  isAnimating = true;
  isPaused = false;
  setPosition(keyframes[0].x, keyframes[0].y);
  renderKeyframes();
  updatePlayPauseButton();
}

function updateAnimation() {
  if (!isAnimating) return;

  const now = millis();
  animationElapsed += now - animationLastTime;
  animationLastTime = now;

  const totalDuration = getTotalDuration();

  if (animationElapsed >= totalDuration) {
    finishAnimation();
    return;
  }

  const { segment, progress } = getAnimationSegment(animationElapsed);
  const easedProgress = easeInOutSine(progress);
  const start = keyframes[segment];
  const end = keyframes[segment + 1];

  setPosition(
    lerp(start.x, end.x, easedProgress),
    lerp(start.y, end.y, easedProgress),
  );
}

function finishAnimation() {
  selectedKeyframe = keyframes.length - 1;
  const lastKeyframe = keyframes[selectedKeyframe];
  setPosition(lastKeyframe.x, lastKeyframe.y);
  durationInput.value = lastKeyframe.duration;
  isAnimating = false;
  isPaused = false;
  renderKeyframes();
  updatePlayPauseButton();

  if (exportRecorder?.state === "recording") {
    setTimeout(() => exportRecorder?.stop(), 100);
  }
}

function stopAnimation() {
  if (!isAnimating && !isPaused) return;

  isAnimating = false;
  isPaused = false;
  animationElapsed = 0;
  updatePlayPauseButton();

  if (exportRecorder?.state === "recording") {
    cancelExport = true;
    exportRecorder.stop();
  }
}

function updatePlayPauseButton() {
  playPauseButton.textContent = isAnimating ? "Pauze" : "Afspelen";
}

function easeInOutSine(value) {
  return -(Math.cos(Math.PI * value) - 1) / 2;
}

function getTotalDuration() {
  return keyframes
    .slice(0, -1)
    .reduce((total, keyframe) => total + keyframe.duration * 1000, 0);
}

function getAnimationSegment(elapsed) {
  let segmentStart = 0;

  for (let index = 0; index < keyframes.length - 1; index += 1) {
    const segmentDuration = keyframes[index].duration * 1000;
    const segmentEnd = segmentStart + segmentDuration;

    if (elapsed < segmentEnd) {
      return {
        segment: index,
        progress: (elapsed - segmentStart) / segmentDuration,
      };
    }

    segmentStart = segmentEnd;
  }

  return { segment: keyframes.length - 2, progress: 1 };
}

function formatDuration(duration) {
  return Number(duration.toFixed(2)).toString();
}

function updateCanvasSize() {
  const newWidth = Math.max(100, Number(canvasWidthInput.value) || width);
  const newHeight = Math.max(100, Number(canvasHeightInput.value) || height);

  canvasWidthInput.value = newWidth;
  canvasHeightInput.value = newHeight;
  resizeCanvas(newWidth, newHeight);
  fitCanvasToContainer();
}

function fitCanvasToContainer() {
  if (!canvasRenderer) return;

  const scale = Math.min(
    1,
    canvasContainer.clientWidth / width,
    canvasContainer.clientHeight / height,
  );

  canvasRenderer.elt.style.setProperty("width", `${width * scale}px`, "important");
  canvasRenderer.elt.style.setProperty("height", `${height * scale}px`, "important");
}

function exportAnimation() {
  if (keyframes.length < 2) return;

  const mimeType = getSupportedMp4Type();
  if (!canvasRenderer.elt.captureStream || typeof MediaRecorder === "undefined" || !mimeType) {
    window.alert("Deze browser ondersteunt geen MP4-export.");
    return;
  }

  stopAnimation();
  cancelExport = false;
  exportChunks = [];

  const stream = canvasRenderer.elt.captureStream(60);

  try {
    exportRecorder = new MediaRecorder(stream, { mimeType });
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    window.alert("De MP4-export kon niet worden gestart.");
    return;
  }

  const recorder = exportRecorder;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) exportChunks.push(event.data);
  });

  recorder.addEventListener("stop", () => {
    stream.getTracks().forEach((track) => track.stop());

    if (!cancelExport && exportChunks.length > 0) {
      downloadRecording(exportChunks, recorder.mimeType || mimeType);
    }

    exportRecorder = null;
    exportChunks = [];
    renderKeyframes();
  });

  recorder.start();
  startAnimation();
}

function getSupportedMp4Type() {
  if (typeof MediaRecorder === "undefined") return "";

  const options = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1",
    "video/mp4",
  ];

  return options.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function downloadRecording(chunks, mimeType) {
  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cqp-animatie.mp4";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
