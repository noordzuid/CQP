const $ = (selector) => document.querySelector(selector);

const canvas = $("#design-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const stage = $("#canvas-stage");
const palette = ["#000000", "#FFFFFF", "#E73583", "#B40046", "#FA4A0A", "#B92B00", "#00AD60", "#006631"];
const editorSettings = { gridSize: 20, rotationStep: 10, circleSnapThreshold: 30, guideSnapThreshold: 12 };
const pixelDensity = 2;
const canvasSize = { width: canvas.width, height: canvas.height };

function setCanvasDimensions(width, height) {
  canvasSize.width = width;
  canvasSize.height = height;
  canvas.width = Math.round(width * pixelDensity);
  canvas.height = Math.round(height * pixelDensity);
}

setCanvasDimensions(canvasSize.width, canvasSize.height);

const ui = {
  mode: $("#mode-select"),
  backgroundSwatches: $("#background-swatches"),
  freeformTools: $("#freeform-tools"),
  addRect: $("#add-rect"),
  gridTools: $("#grid-tools"),
  splitHorizontal: $("#split-horizontal"),
  splitVertical: $("#split-vertical"),
  mergeCell: $("#merge-cell"),
  contextMenu: $("#context-menu"),
  contextLabel: $("#context-label"),
  contextSwatches: $("#context-swatches"),
  contextEditText: $("#context-edit-text"),
  contextTextControls: $("#context-text-controls"),
  contextFontSize: $("#context-font-size"),
  contextTextAlign: $("#context-text-align"),
  contextTextVerticalAlign: $("#context-text-vertical-align"),
  contextRotationInput: $("#context-rotation-input"),
  contextActions: $("#context-actions"),
  contextDuplicate: $("#context-duplicate"),
  contextDelete: $("#context-delete"),
  inlineTextEditor: $("#inline-text-editor"),
  keyframeList: $("#keyframe-list"),
  duration: $("#duration-input"),
  easing: $("#easing-select"),
  loop: $("#loop-input"),
  play: $("#play-button"),
  removeKeyframe: $("#remove-keyframe"),
  width: $("#width-input"),
  height: $("#height-input"),
  exportStatus: $("#export-status"),
};

let nextId = 1;
let nextSplitId = 1;
const createId = () => `element-${nextId++}`;
const createSplitId = () => `split-${nextSplitId++}`;
const deepCopy = (value) => JSON.parse(JSON.stringify(value));

function leaf(name, fill) {
  return { kind: "leaf", id: createId(), name, fill };
}

function split(direction, ratio, first, second) {
  return { kind: "split", id: createSplitId(), direction, ratio, first, second };
}

function defaultGrid() {
  return split(
    "vertical",
    .5,
    split("horizontal", .5, leaf("Vlak 1", "#E73583"), leaf("Vlak 2", "#B40046")),
    split("horizontal", .5, leaf("Vlak 3", "#FA4A0A"), leaf("Vlak 4", "#B92B00")),
  );
}

function circlesPreset() {
  return {
    mode: "circles",
    background: "#FFFFFF",
    elements: [
      { id: createId(), type: "circle", name: "Cirkel roze", x: 160, y: 280, w: 520, h: 520, fill: "#E73583" },
      { id: createId(), type: "circle", name: "Cirkel oranje", x: 400, y: 280, w: 520, h: 520, fill: "#FA4A0A" },
      { id: createId(), type: "text", name: "Tekst", x: 140, y: 100, w: 800, h: 120, fill: "#000000", text: "Lorem ipsum", fontSize: 80, textAlign: "left", verticalAlign: "top", rotation: 0 },
    ],
    grid: null,
    duration: 800,
  };
}

function gridPreset() {
  return {
    mode: "grid",
    background: "#FFFFFF",
    elements: [],
    grid: defaultGrid(),
    duration: 800,
  };
}

let keyframes = [circlesPreset()];
let selectedFrame = 0;
let selectedElementId = keyframes[0].elements[0].id;
let viewFrame = null;
let drag = null;
let isPlaying = false;
let playRequest = 0;
let recorder = null;
let recordedChunks = [];
let undoStack = [];
let pendingTextSnapshot = null;
let editingTextId = null;
let activeGuides = [];
let copiedElement = null;

const snap = (value) => Math.round(value / editorSettings.gridSize) * editorSettings.gridSize;
const minimumGridSize = (value) => Math.max(editorSettings.gridSize, snap(value));

function projectSnapshot() {
  return JSON.stringify({
    keyframes,
    selectedFrame,
    selectedElementId,
    width: canvasSize.width,
    height: canvasSize.height,
    easing: ui.easing.value,
    loop: ui.loop.checked,
  });
}

function saveUndoSnapshot(snapshot = projectSnapshot()) {
  if (undoStack.at(-1) === snapshot) return;
  undoStack.push(snapshot);
  if (undoStack.length > 100) undoStack.shift();
}

function undo() {
  const snapshot = undoStack.pop();
  if (!snapshot) return;
  stopPlayback();
  closeInlineTextEditor(false);
  const state = JSON.parse(snapshot);
  keyframes = state.keyframes;
  selectedFrame = state.selectedFrame;
  selectedElementId = state.selectedElementId;
  setCanvasDimensions(state.width, state.height);
  ui.width.value = state.width;
  ui.height.value = state.height;
  ui.easing.value = state.easing;
  ui.loop.checked = Boolean(state.loop);
  pendingTextSnapshot = null;
  syncUI();
  fitCanvas();
}

function currentFrame() { return keyframes[selectedFrame]; }
function displayFrame() { return viewFrame || currentFrame(); }

function getLeaves(node, output = []) {
  if (!node) return output;
  if (node.kind === "leaf") output.push(node);
  else {
    getLeaves(node.first, output);
    getLeaves(node.second, output);
  }
  return output;
}

function findNode(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  if (node.kind === "leaf") return null;
  return findNode(node.first, id) || findNode(node.second, id);
}

function findParent(node, id, parent = null) {
  if (!node) return null;
  if (node.id === id) return parent;
  if (node.kind === "leaf") return null;
  return findParent(node.first, id, node) || findParent(node.second, id, node);
}

function replaceNode(node, id, replacement) {
  if (node.id === id) return replacement;
  if (node.kind === "split") {
    node.first = replaceNode(node.first, id, replacement);
    node.second = replaceNode(node.second, id, replacement);
  }
  return node;
}

function currentItem() {
  const frame = currentFrame();
  if (!frame) return null;
  const overlay = frame.elements.find((item) => item.id === selectedElementId);
  if (overlay) return overlay;
  return frame.mode === "grid" ? findNode(frame.grid, selectedElementId) : null;
}

function createSwatches(container, onChoose) {
  palette.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.setProperty("--swatch", color);
    button.dataset.color = color;
    button.setAttribute("aria-label", color);
    button.addEventListener("click", () => onChoose(color));
    container.append(button);
  });
}

createSwatches(ui.backgroundSwatches, (color) => {
  stopPlayback();
  if (currentFrame().background === color) return;
  saveUndoSnapshot();
  currentFrame().background = color;
  syncUI();
});

createSwatches(ui.contextSwatches, (color) => {
  const item = currentItem();
  if (!item) return;
  stopPlayback();
  if (item.fill === color) return;
  saveUndoSnapshot();
  item.fill = color;
  refreshContextMenu();
  render();
});

function setPressedSwatch(container, color) {
  container.querySelectorAll(".swatch").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.color === color));
  });
}

function setPressedValue(container, value) {
  container.querySelectorAll("button[data-value]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.value === value));
  });
}

function syncUI() {
  const frame = currentFrame();
  const item = currentItem();
  const isGrid = frame.mode === "grid";

  ui.mode.value = frame.mode;
  ui.duration.value = frame.duration;
  ui.freeformTools.hidden = false;
  ui.addRect.hidden = isGrid;
  ui.freeformTools.classList.toggle("two-tools", isGrid);
  ui.gridTools.hidden = !isGrid;
  setPressedSwatch(ui.backgroundSwatches, frame.background);

  ui.splitHorizontal.disabled = !isGrid || !item || item.kind !== "leaf";
  ui.splitVertical.disabled = !isGrid || !item || item.kind !== "leaf";
  ui.mergeCell.disabled = !isGrid || !item || !findParent(frame.grid, item.id);

  renderKeyframes();
  refreshContextMenu();
  render();
}

function renderKeyframes() {
  ui.keyframeList.replaceChildren();
  keyframes.forEach((frame, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `keyframe-item${index === selectedFrame ? " selected" : ""}`;
    button.textContent = `Keyframe ${index + 1}`;
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", String(index === selectedFrame));
    button.addEventListener("click", () => selectFrame(index));
    ui.keyframeList.append(button);
  });
  ui.removeKeyframe.disabled = keyframes.length === 1 || isPlaying;
  ui.play.disabled = keyframes.length === 1;
  ui.loop.disabled = isPlaying;
}

function fitCanvas() {
  const availableWidth = Math.max(1, stage.clientWidth);
  const availableHeight = Math.max(1, stage.clientHeight);
  const scale = Math.min(1, availableWidth / canvasSize.width, availableHeight / canvasSize.height);
  canvas.style.width = `${Math.round(canvasSize.width * scale)}px`;
  canvas.style.height = `${Math.round(canvasSize.height * scale)}px`;
  if (editingTextId) positionInlineTextEditor();
  render();
}

function gridLayout(node, x = 0, y = 0, w = canvasSize.width, h = canvasSize.height, output = { leaves: [], dividers: [] }) {
  if (node.kind === "leaf") {
    output.leaves.push({ node, x, y, w, h });
    return output;
  }

  if (node.direction === "vertical") {
    const firstWidth = w * node.ratio;
    output.dividers.push({ node, x: x + firstWidth, y, length: h, direction: "vertical", bounds: { x, y, w, h } });
    gridLayout(node.first, x, y, firstWidth, h, output);
    gridLayout(node.second, x + firstWidth, y, w - firstWidth, h, output);
  } else {
    const firstHeight = h * node.ratio;
    output.dividers.push({ node, x, y: y + firstHeight, length: w, direction: "horizontal", bounds: { x, y, w, h } });
    gridLayout(node.first, x, y, w, firstHeight, output);
    gridLayout(node.second, x, y + firstHeight, w, h - firstHeight, output);
  }
  return output;
}

function gridAlignedSplitRatio(direction, bounds, targetCoordinate) {
  const start = direction === "vertical" ? bounds.x : bounds.y;
  const length = direction === "vertical" ? bounds.w : bounds.h;
  const end = start + length;
  const minimum = Math.ceil((start + editorSettings.gridSize) / editorSettings.gridSize) * editorSettings.gridSize;
  const maximum = Math.floor((end - editorSettings.gridSize) / editorSettings.gridSize) * editorSettings.gridSize;
  if (maximum < minimum || length <= 0) return .5;
  const coordinate = Math.max(minimum, Math.min(maximum, snap(targetCoordinate)));
  return (coordinate - start) / length;
}

function alignGridDividers(node, x = 0, y = 0, w = canvasSize.width, h = canvasSize.height) {
  if (!node || node.kind === "leaf") return;
  const bounds = { x, y, w, h };
  const currentCoordinate = node.direction === "vertical" ? x + w * node.ratio : y + h * node.ratio;
  node.ratio = gridAlignedSplitRatio(node.direction, bounds, currentCoordinate);
  if (node.direction === "vertical") {
    const firstWidth = w * node.ratio;
    alignGridDividers(node.first, x, y, firstWidth, h);
    alignGridDividers(node.second, x + firstWidth, y, w - firstWidth, h);
  } else {
    const firstHeight = h * node.ratio;
    alignGridDividers(node.first, x, y, w, firstHeight);
    alignGridDividers(node.second, x, y + firstHeight, w, h - firstHeight);
  }
}

function wrappedTextLines(element) {
  ctx.save();
  ctx.font = `500 ${element.fontSize}px "Jokker", sans-serif`;
  const lines = [];
  String(element.text || "").split("\n").forEach((paragraph) => {
    if (!paragraph) { lines.push(""); return; }
    const words = paragraph.split(/\s+/);
    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(candidate).width > element.w) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    });
    lines.push(line);
  });
  ctx.restore();
  return lines.length ? lines : [""];
}

function updateTextHeight(element) {
  if (element?.type !== "text") return;
  const lineHeight = element.fontSize * 1.12;
  element.h = Math.max(editorSettings.gridSize, Math.ceil((wrappedTextLines(element).length * lineHeight) / editorSettings.gridSize) * editorSettings.gridSize);
}

function drawElement(element) {
  if (element.id === editingTextId) return;
  ctx.fillStyle = element.fill;
  if (element.type === "circle") {
    ctx.beginPath();
    ctx.ellipse(element.x + element.w / 2, element.y + element.h / 2, Math.abs(element.w / 2), Math.abs(element.h / 2), 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (element.type === "rect") {
    ctx.fillRect(element.x, element.y, element.w, element.h);
  } else {
    const centerX = element.x + element.w / 2;
    const centerY = element.y + element.h / 2;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(((element.rotation || 0) * Math.PI) / 180);
    ctx.font = `500 ${element.fontSize}px "Jokker", sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = element.textAlign || "left";
    const lineHeight = element.fontSize * 1.12;
    const lines = wrappedTextLines(element);
    const contentHeight = lines.length * lineHeight;
    const textX = element.textAlign === "center" ? 0 : element.textAlign === "right" ? element.w / 2 : -element.w / 2;
    const textY = element.verticalAlign === "middle"
      ? -contentHeight / 2
      : element.verticalAlign === "bottom" ? element.h / 2 - contentHeight : -element.h / 2;
    lines.forEach((line, index) => {
      ctx.fillText(line, textX, textY + index * lineHeight);
    });
    ctx.restore();
  }
}

function drawSelectionBox(box) {
  const line = Math.max(2, canvasSize.width / 540);
  ctx.save();
  ctx.strokeStyle = "#006CFF";
  ctx.lineWidth = line;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(box.x + line, box.y + line, Math.max(0, box.w - line * 2), Math.max(0, box.h - line * 2));
  ctx.restore();
}

function rotationHandleOffset() {
  return Math.max(36, canvasSize.width / 30);
}

function drawFreeformSelection(element) {
  if (!element) return;
  const line = Math.max(2, canvasSize.width / 540);
  const handle = Math.max(13, canvasSize.width / 82);
  const halfWidth = element.w / 2;
  const halfHeight = element.h / 2;
  const handles = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight],
  ];
  if (element.type === "text") handles.push([-halfWidth, 0], [halfWidth, 0]);

  ctx.save();
  ctx.translate(element.x + halfWidth, element.y + halfHeight);
  ctx.rotate(((element.rotation || 0) * Math.PI) / 180);
  ctx.strokeStyle = "#006CFF";
  ctx.lineWidth = line;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(-halfWidth, -halfHeight, element.w, element.h);
  ctx.setLineDash([]);
  ctx.fillStyle = "#FFFFFF";
  handles.forEach(([x, y]) => {
    ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
    ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
  });
  if (element.type === "text") {
    const offset = rotationHandleOffset();
    ctx.beginPath();
    ctx.moveTo(0, -halfHeight);
    ctx.lineTo(0, -halfHeight - offset);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -halfHeight - offset, handle * .48, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawSmartGuides() {
  if (!activeGuides.length) return;
  ctx.save();
  ctx.strokeStyle = "#ff2d8d";
  ctx.lineWidth = Math.max(1.5, canvasSize.width / 900);
  ctx.setLineDash([8, 6]);
  activeGuides.forEach((guide) => {
    ctx.beginPath();
    if (guide.axis === "x") {
      ctx.moveTo(guide.position, 0);
      ctx.lineTo(guide.position, canvasSize.height);
    } else {
      ctx.moveTo(0, guide.position);
      ctx.lineTo(canvasSize.width, guide.position);
    }
    ctx.stroke();
  });
  ctx.restore();
}

function render(includeSelection = true) {
  const frame = displayFrame();
  if (!frame) return;
  ctx.save();
  ctx.setTransform(pixelDensity, 0, 0, pixelDensity, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = frame.background;
  ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);

  if (frame.mode === "grid") {
    const layout = gridLayout(frame.grid);
    layout.leaves.forEach(({ node, x, y, w, h }) => {
      ctx.fillStyle = node.fill;
      ctx.fillRect(x, y, w + .5, h + .5);
    });
    frame.elements.forEach(drawElement);
    if (includeSelection && !isPlaying && !viewFrame) {
      const selectedOverlay = frame.elements.find((element) => element.id === selectedElementId);
      const selectedCell = layout.leaves.find(({ node }) => node.id === selectedElementId);
      if (selectedOverlay && !editingTextId) drawFreeformSelection(selectedOverlay);
      else if (selectedCell) drawSelectionBox(selectedCell);
    }
  } else {
    frame.elements.forEach(drawElement);
    if (includeSelection && !isPlaying && !viewFrame && !editingTextId) drawFreeformSelection(currentItem());
  }
  if (includeSelection && !isPlaying && !viewFrame) drawSmartGuides();
  ctx.restore();
}

function firstSelectable(frame) {
  return frame.mode === "grid" ? getLeaves(frame.grid)[0]?.id || null : frame.elements[0]?.id || null;
}

function selectFrame(index) {
  stopPlayback();
  closeInlineTextEditor(true);
  selectedFrame = index;
  selectedElementId = firstSelectable(currentFrame());
  syncUI();
}

function addElement(type) {
  stopPlayback();
  const frame = currentFrame();
  if (frame.mode === "grid" && type === "rect") return;
  saveUndoSnapshot();
  const count = frame.elements.filter((item) => item.type === type).length + 1;
  const base = Math.min(canvasSize.width, canvasSize.height);
  const element = {
    id: createId(), type, name: type === "text" ? `Tekst ${count}` : type === "circle" ? `Cirkel ${count}` : `Vlak ${count}`,
    x: snap(canvasSize.width * .32), y: snap(canvasSize.height * .32), w: snap(base * .36), h: snap(base * .36),
    fill: type === "text" ? "#000000" : palette[(frame.elements.length + 2) % palette.length],
  };
  if (type === "text") Object.assign(element, { text: "Lorem ipsum", fontSize: minimumGridSize(base * .075), h: snap(base * .1), w: snap(canvasSize.width * .55), textAlign: "left", verticalAlign: "top", rotation: 0 });
  frame.elements.push(element);
  selectedElementId = element.id;
  syncUI();
}

function deleteSelectedElement() {
  const frame = currentFrame();
  const index = frame.elements.findIndex((item) => item.id === selectedElementId);
  if (index < 0) return;
  saveUndoSnapshot();
  frame.elements.splice(index, 1);
  selectedElementId = frame.elements[Math.min(index, frame.elements.length - 1)]?.id || null;
  syncUI();
}

function duplicateSelectedElement() {
  const frame = currentFrame();
  const element = currentItem();
  if (!element || element.kind === "leaf") return;
  saveUndoSnapshot();
  const copy = deepCopy(element);
  copy.id = createId();
  copy.name = `${element.name} kopie`;
  copy.x = snap(copy.x + editorSettings.gridSize);
  copy.y = snap(copy.y + editorSettings.gridSize);
  frame.elements.push(copy);
  selectedElementId = copy.id;
  syncUI();
}

function copySelectedElement() {
  const element = currentItem();
  if (!element?.type) return false;
  copiedElement = deepCopy(element);
  return true;
}

function pasteCopiedElement() {
  if (!copiedElement || isPlaying) return false;
  const frame = currentFrame();
  if (frame.mode === "grid" && copiedElement.type === "rect") return false;
  stopPlayback();
  saveUndoSnapshot();
  const copy = deepCopy(copiedElement);
  copy.id = createId();
  copy.name = `${copy.type === "text" ? "Tekst" : copy.type === "circle" ? "Cirkel" : "Vlak"} kopie`;
  copy.x = snap(copy.x + editorSettings.gridSize);
  copy.y = snap(copy.y + editorSettings.gridSize);
  frame.elements.push(copy);
  copiedElement = deepCopy(copy);
  selectedElementId = copy.id;
  syncUI();
  return true;
}

function splitSelectedCell(direction) {
  const frame = currentFrame();
  const selected = currentItem();
  if (frame.mode !== "grid" || selected?.kind !== "leaf") return;
  stopPlayback();
  saveUndoSnapshot();
  const leafCount = getLeaves(frame.grid).length;
  const newCell = leaf(`Vlak ${leafCount + 1}`, palette[(leafCount + 2) % palette.length]);
  const selectedBounds = gridLayout(frame.grid).leaves.find(({ node }) => node.id === selected.id);
  const targetCoordinate = direction === "vertical"
    ? selectedBounds.x + selectedBounds.w / 2
    : selectedBounds.y + selectedBounds.h / 2;
  const ratio = gridAlignedSplitRatio(direction, selectedBounds, targetCoordinate);
  const replacement = split(direction, ratio, deepCopy(selected), newCell);
  frame.grid = replaceNode(frame.grid, selected.id, replacement);
  selectedElementId = newCell.id;
  syncUI();
}

function mergeSelectedCell() {
  const frame = currentFrame();
  const selected = currentItem();
  if (frame.mode !== "grid" || selected?.kind !== "leaf") return;
  const parent = findParent(frame.grid, selected.id);
  if (!parent) return;
  stopPlayback();
  saveUndoSnapshot();
  frame.grid = replaceNode(frame.grid, parent.id, deepCopy(selected));
  syncUI();
}

function scaleFreeform(frame, fromWidth, fromHeight, toWidth, toHeight) {
  const scale = Math.min(toWidth / fromWidth, toHeight / fromHeight);
  frame.elements.forEach((element) => {
    const oldCenterX = element.x + element.w / 2;
    const oldCenterY = element.y + element.h / 2;
    const newWidth = Math.max(editorSettings.gridSize, snap(element.w * scale));
    const newHeight = Math.max(editorSettings.gridSize, snap(element.h * scale));
    const newCenterX = toWidth / 2 + (oldCenterX - fromWidth / 2) * scale;
    const newCenterY = toHeight / 2 + (oldCenterY - fromHeight / 2) * scale;
    element.w = newWidth;
    element.h = newHeight;
    element.x = snap(newCenterX - newWidth / 2);
    element.y = snap(newCenterY - newHeight / 2);
    if (element.type === "text") {
      element.fontSize = minimumGridSize(element.fontSize * scale);
      updateTextHeight(element);
    }
  });
}

function changeMode(mode) {
  stopPlayback();
  if (mode === currentFrame().mode) return;
  saveUndoSnapshot();
  const replacement = mode === "grid" ? gridPreset() : circlesPreset();
  scaleFreeform(replacement, 1080, 1080, canvasSize.width, canvasSize.height);
  if (replacement.mode === "grid") alignGridDividers(replacement.grid);
  replacement.duration = currentFrame().duration;
  keyframes[selectedFrame] = replacement;
  selectedElementId = firstSelectable(replacement);
  syncUI();
}

function addKeyframe() {
  stopPlayback();
  saveUndoSnapshot();
  const copy = deepCopy(currentFrame());
  keyframes.splice(selectedFrame + 1, 0, copy);
  selectedFrame += 1;
  selectedElementId = firstSelectable(copy);
  syncUI();
  ui.keyframeList.lastElementChild?.scrollIntoView({ block: "nearest" });
}

function removeKeyframe() {
  if (keyframes.length === 1) return;
  stopPlayback();
  saveUndoSnapshot();
  keyframes.splice(selectedFrame, 1);
  selectedFrame = Math.min(selectedFrame, keyframes.length - 1);
  selectedElementId = firstSelectable(currentFrame());
  syncUI();
}

const easingFns = {
  linear: (t) => t,
  easeInOutCubic: (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutExpo: (t) => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
  easeInOutCirc: (t) => t < .5 ? (1 - Math.sqrt(1 - Math.pow(2 * t, 2))) / 2 : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2,
};

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function mixColor(a, b, t) {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return `rgb(${ca.map((value, index) => Math.round(value + (cb[index] - value) * t)).join(",")})`;
}

function mix(a, b, t) { return a + (b - a) * t; }

function mixAngle(a = 0, b = 0, t) {
  const difference = ((b - a + 540) % 360) - 180;
  return a + difference * t;
}

function sameGridStructure(a, b) {
  if (!a || !b || a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === "leaf") return true;
  return a.direction === b.direction && sameGridStructure(a.first, b.first) && sameGridStructure(a.second, b.second);
}

function interpolateGrid(a, b, t) {
  if (a.kind === "leaf") return { ...a, fill: mixColor(a.fill, b.fill, t) };
  return {
    ...a,
    ratio: mix(a.ratio, b.ratio, t),
    first: interpolateGrid(a.first, b.first, t),
    second: interpolateGrid(a.second, b.second, t),
  };
}

function interpolateElements(startElements, endElements, t) {
  const startById = new Map(startElements.map((item) => [item.id, item]));
  const endById = new Map(endElements.map((item) => [item.id, item]));
  const source = t === 1 ? endElements : startElements;
  return source.map((item) => {
    const a = startById.get(item.id);
    const b = endById.get(item.id);
    if (!a || !b || a.type !== b.type) return deepCopy(item);
    return {
      ...a,
      x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), w: mix(a.w, b.w, t), h: mix(a.h, b.h, t),
      fill: mixColor(a.fill, b.fill, t), text: t < .5 ? a.text : b.text,
      fontSize: a.type === "text" ? mix(a.fontSize, b.fontSize, t) : undefined,
      textAlign: a.type === "text" ? (t < .5 ? a.textAlign || "left" : b.textAlign || "left") : undefined,
      verticalAlign: a.type === "text" ? (t < .5 ? a.verticalAlign || "top" : b.verticalAlign || "top") : undefined,
      rotation: a.type === "text" ? mixAngle(a.rotation, b.rotation, t) : undefined,
    };
  });
}

function interpolateFrames(start, end, t) {
  if (start.mode !== end.mode) return deepCopy(t < 1 ? start : end);
  if (start.mode === "grid") {
    if (!sameGridStructure(start.grid, end.grid)) return deepCopy(t < 1 ? start : end);
    return {
      ...deepCopy(start),
      background: mixColor(start.background, end.background, t),
      grid: interpolateGrid(start.grid, end.grid, t),
      elements: interpolateElements(start.elements, end.elements, t),
    };
  }

  return {
    ...deepCopy(start),
    background: mixColor(start.background, end.background, t),
    elements: interpolateElements(start.elements, end.elements, t),
  };
}

function playAnimation() {
  if (keyframes.length < 2) return Promise.resolve();
  stopPlayback();
  closeInlineTextEditor(true);
  const selectedBeforePlayback = selectedElementId;
  isPlaying = true;
  ui.play.textContent = "Stop";
  renderKeyframes();
  const shouldLoop = ui.loop.checked;
  const segmentCount = shouldLoop ? keyframes.length : keyframes.length - 1;
  let segment = 0;
  let segmentStart = performance.now();

  return new Promise((resolve) => {
    const tick = (now) => {
      if (!isPlaying) { viewFrame = null; resolve(); return; }
      const start = keyframes[segment];
      const end = keyframes[(segment + 1) % keyframes.length];
      const raw = Math.min(1, (now - segmentStart) / start.duration);
      viewFrame = interpolateFrames(start, end, easingFns[ui.easing.value](raw));
      render(false);
      if (raw >= 1) {
        segment += 1;
        if (segment >= segmentCount) {
          selectedFrame = shouldLoop ? 0 : keyframes.length - 1;
          const finalFrame = currentFrame();
          const selectionStillExists = selectedBeforePlayback && (
            finalFrame.elements.some((element) => element.id === selectedBeforePlayback)
            || (finalFrame.mode === "grid" && findNode(finalFrame.grid, selectedBeforePlayback))
          );
          selectedElementId = selectionStillExists ? selectedBeforePlayback : null;
          isPlaying = false;
          viewFrame = null;
          ui.play.textContent = "Play";
          syncUI();
          resolve();
          return;
        }
        segmentStart = now;
      }
      playRequest = requestAnimationFrame(tick);
    };
    playRequest = requestAnimationFrame(tick);
  });
}

function stopPlayback() {
  if (!isPlaying && !viewFrame) return;
  isPlaying = false;
  cancelAnimationFrame(playRequest);
  viewFrame = null;
  ui.play.textContent = "Play";
  renderKeyframes();
  render();
  if (recorder?.state === "recording") recorder.stop();
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) * canvasSize.width / rect.width, y: (event.clientY - rect.top) * canvasSize.height / rect.height };
}

function pointInElementSpace(point, element) {
  if (element.type !== "text" || !element.rotation) return point;
  const centerX = element.x + element.w / 2;
  const centerY = element.y + element.h / 2;
  const radians = (-element.rotation * Math.PI) / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  return {
    x: centerX + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: centerY + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

function snapCircleToNeighbors(element, proposedX, proposedY) {
  if (element.type !== "circle") return { x: proposedX, y: proposedY, snapped: false };
  const radius = element.w / 2;
  const center = { x: proposedX + radius, y: proposedY + radius };
  let best = null;

  currentFrame().elements.forEach((other) => {
    if (other.id === element.id || other.type !== "circle") return;
    const otherRadius = other.w / 2;
    const otherCenter = { x: other.x + otherRadius, y: other.y + otherRadius };
    const dx = center.x - otherCenter.x;
    const dy = center.y - otherCenter.y;
    const distance = Math.hypot(dx, dy);
    const targetDistance = radius + otherRadius;
    const difference = Math.abs(distance - targetDistance);
    if (!distance || difference > editorSettings.circleSnapThreshold || (best && difference >= best.difference)) return;
    const factor = targetDistance / distance;
    best = {
      difference,
      x: otherCenter.x + dx * factor - radius,
      y: otherCenter.y + dy * factor - radius,
    };
  });

  // The regular drag position stays on the universal grid. Close to another
  // circle, exact tangency temporarily wins so diagonal joins never gap or overlap.
  return best ? { x: best.x, y: best.y, snapped: true } : { x: proposedX, y: proposedY, snapped: false };
}

function snapElementToSmartGuides(element, proposedX, proposedY, allowSnap = true) {
  const centerX = proposedX + element.w / 2;
  const centerY = proposedY + element.h / 2;
  const xTargets = [canvasSize.width / 2];
  const yTargets = [canvasSize.height / 2];
  currentFrame().elements.forEach((other) => {
    if (other.id === element.id) return;
    xTargets.push(other.x + other.w / 2);
    yTargets.push(other.y + other.h / 2);
  });

  const closest = (targets, value) => targets.reduce((best, target) => {
    const distance = Math.abs(target - value);
    return !best || distance < best.distance ? { target, distance } : best;
  }, null);
  const xMatch = closest(xTargets, centerX);
  const yMatch = closest(yTargets, centerY);
  const threshold = allowSnap ? editorSettings.guideSnapThreshold : .5;
  const guides = [];
  let x = proposedX;
  let y = proposedY;

  if (xMatch?.distance <= threshold) {
    if (allowSnap) x += xMatch.target - centerX;
    guides.push({ axis: "x", position: xMatch.target });
  }
  if (yMatch?.distance <= threshold) {
    if (allowSnap) y += yMatch.target - centerY;
    guides.push({ axis: "y", position: yMatch.target });
  }
  return { x, y, guides };
}

const cornerHandles = {
  nw: [0, 0],
  ne: [1, 0],
  se: [1, 1],
  sw: [0, 1],
};

function handleAt(point, element) {
  if (!element) return null;
  const localPoint = pointInElementSpace(point, element);
  const tolerance = Math.max(18, canvasSize.width / 55);
  if (element.type === "text") {
    const rotationX = element.x + element.w / 2;
    const rotationY = element.y - rotationHandleOffset();
    if (Math.hypot(localPoint.x - rotationX, localPoint.y - rotationY) <= tolerance) return "rotate";
  }
  const points = Object.entries(cornerHandles).map(([name, [xFactor, yFactor]]) => ({
    name,
    x: element.x + element.w * xFactor,
    y: element.y + element.h * yFactor,
  }));
  if (element.type === "text") {
    points.push(
      { name: "text-w", x: element.x, y: element.y + element.h / 2 },
      { name: "text-e", x: element.x + element.w, y: element.y + element.h / 2 },
    );
  }
  return points.find(({ x, y }) => Math.abs(localPoint.x - x) <= tolerance && Math.abs(localPoint.y - y) <= tolerance)?.name || null;
}

function handleCursor(handle) {
  if (handle === "rotate") return "grab";
  if (handle === "text-w" || handle === "text-e") return "ew-resize";
  return handle === "ne" || handle === "sw" ? "nesw-resize" : "nwse-resize";
}

function resizeFromCorner(element, original, handle, point) {
  const localPoint = pointInElementSpace(point, original);
  const isLeft = handle === "nw" || handle === "sw";
  const isTop = handle === "nw" || handle === "ne";
  const fixedX = isLeft ? original.x + original.w : original.x;
  const fixedY = isTop ? original.y + original.h : original.y;
  let newWidth = minimumGridSize(Math.abs(localPoint.x - fixedX));
  let newHeight = minimumGridSize(Math.abs(localPoint.y - fixedY));
  const preserveRatio = element.type === "circle" || element.type === "text";

  if (preserveRatio) {
    if (element.type === "circle") {
      const size = minimumGridSize(Math.max(newWidth, newHeight));
      newWidth = size;
      newHeight = size;
    } else {
      const widthScale = newWidth / original.w;
      const heightScale = newHeight / original.h;
      const scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;
      newWidth = minimumGridSize(original.w * scale);
      newHeight = minimumGridSize(original.h * scale);
    }
  }

  element.w = newWidth;
  element.h = newHeight;
  element.x = snap(isLeft ? fixedX - newWidth : fixedX);
  element.y = snap(isTop ? fixedY - newHeight : fixedY);
  if (element.type === "text") element.fontSize = minimumGridSize(original.fontSize * (newHeight / original.h));
}

function elementAt(point) {
  const elements = currentFrame().elements;
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const item = elements[index];
    const localPoint = pointInElementSpace(point, item);
    if (localPoint.x < item.x || localPoint.x > item.x + item.w || localPoint.y < item.y || localPoint.y > item.y + item.h) continue;
    if (item.type !== "circle") return item;
    const dx = (localPoint.x - item.x - item.w / 2) / (item.w / 2);
    const dy = (localPoint.y - item.y - item.h / 2) / (item.h / 2);
    if (dx * dx + dy * dy <= 1) return item;
  }
  return null;
}

function cellAt(point, layout) {
  return layout.leaves.find((cell) => point.x >= cell.x && point.x <= cell.x + cell.w && point.y >= cell.y && point.y <= cell.y + cell.h) || null;
}

function dividersAt(point, layout) {
  const tolerance = Math.max(12, canvasSize.width / 75);
  return [...layout.dividers].reverse().filter((divider) => {
    if (divider.direction === "vertical") {
      return Math.abs(point.x - divider.x) <= tolerance
        && point.y >= divider.y - tolerance
        && point.y <= divider.y + divider.length + tolerance;
    }
    return Math.abs(point.y - divider.y) <= tolerance
      && point.x >= divider.x - tolerance
      && point.x <= divider.x + divider.length + tolerance;
  });
}

function dividerAt(point, layout) {
  return dividersAt(point, layout)[0] || null;
}

function junctionAt(point, layout) {
  const dividers = dividersAt(point, layout);
  const hasVertical = dividers.some((divider) => divider.direction === "vertical");
  const hasHorizontal = dividers.some((divider) => divider.direction === "horizontal");
  return hasVertical && hasHorizontal ? dividers : null;
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  if (isPlaying) return;
  activeGuides = [];
  const point = canvasPoint(event);
  const frame = currentFrame();
  const selected = currentItem();
  const selectedOverlay = selected?.type ? selected : null;
  const selectedHandle = handleAt(point, selectedOverlay);

  if (selectedOverlay && selectedHandle) {
    drag = {
      mode: selectedHandle === "rotate" ? "rotate" : selectedHandle.startsWith("text-") ? "text-width" : "resize",
      handle: selectedHandle,
      start: point,
      original: deepCopy(selectedOverlay),
      before: projectSnapshot(),
      changed: false,
    };
    if (drag.mode === "rotate") canvas.style.cursor = "grabbing";
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  const overlayHit = elementAt(point);
  if (overlayHit) {
    selectedElementId = overlayHit.id;
    drag = { mode: "move", start: point, original: deepCopy(overlayHit), before: projectSnapshot(), changed: false };
    syncUI();
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  if (frame.mode === "grid") {
    const layout = gridLayout(frame.grid);
    const junction = junctionAt(point, layout);
    const divider = junction ? null : dividerAt(point, layout);
    if (junction) {
      drag = {
        mode: "junction",
        dividers: junction.map((item) => ({ splitId: item.node.id, direction: item.direction, bounds: item.bounds })),
        before: projectSnapshot(),
        changed: false,
      };
      canvas.style.cursor = "move";
    } else if (divider) {
      drag = { mode: "divider", splitId: divider.node.id, bounds: divider.bounds, before: projectSnapshot(), changed: false };
      canvas.style.cursor = divider.direction === "vertical" ? "col-resize" : "row-resize";
    } else {
      const cell = cellAt(point, layout);
      selectedElementId = cell?.node.id || null;
      drag = null;
      syncUI();
    }
    canvas.setPointerCapture(event.pointerId);
    return;
  }

  selectedElementId = null;
  drag = null;
  syncUI();
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  const frame = currentFrame();

  if (!drag) {
    const selected = currentItem();
    const selectedOverlay = selected?.type ? selected : null;
    const selectedHandle = handleAt(point, selectedOverlay);
    if (selectedHandle) {
      canvas.style.cursor = handleCursor(selectedHandle);
      return;
    }
    if (frame.mode === "grid") {
      const overlay = elementAt(point);
      const layout = gridLayout(frame.grid);
      const junction = junctionAt(point, layout);
      const divider = junction ? null : dividerAt(point, layout);
      canvas.style.cursor = overlay ? "move" : junction ? "move" : divider ? (divider.direction === "vertical" ? "col-resize" : "row-resize") : "default";
    } else {
      canvas.style.cursor = elementAt(point) ? "move" : "default";
    }
    return;
  }

  if (drag.mode === "divider") {
    const splitNode = findNode(frame.grid, drag.splitId);
    if (!splitNode) return;
    if (!drag.changed) { saveUndoSnapshot(drag.before); drag.changed = true; }
    const targetCoordinate = splitNode.direction === "vertical" ? point.x : point.y;
    splitNode.ratio = gridAlignedSplitRatio(splitNode.direction, drag.bounds, targetCoordinate);
    render();
    return;
  }

  if (drag.mode === "junction") {
    if (!drag.changed) { saveUndoSnapshot(drag.before); drag.changed = true; }
    drag.dividers.forEach((divider) => {
      const splitNode = findNode(frame.grid, divider.splitId);
      if (!splitNode) return;
      const targetCoordinate = divider.direction === "vertical" ? point.x : point.y;
      splitNode.ratio = gridAlignedSplitRatio(divider.direction, divider.bounds, targetCoordinate);
    });
    render();
    return;
  }

  const element = currentItem();
  if (!element) return;
  if (!drag.changed) { saveUndoSnapshot(drag.before); drag.changed = true; }
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  if (drag.mode === "move") {
    const circlePosition = snapCircleToNeighbors(
      element,
      snap(drag.original.x + dx),
      snap(drag.original.y + dy),
    );
    const guidedPosition = snapElementToSmartGuides(element, circlePosition.x, circlePosition.y, !circlePosition.snapped);
    element.x = guidedPosition.x;
    element.y = guidedPosition.y;
    activeGuides = guidedPosition.guides;
  } else if (drag.mode === "rotate") {
    activeGuides = [];
    const centerX = drag.original.x + drag.original.w / 2;
    const centerY = drag.original.y + drag.original.h / 2;
    const rawAngle = Math.atan2(point.y - centerY, point.x - centerX) * 180 / Math.PI + 90;
    const snappedAngle = Math.round(rawAngle / editorSettings.rotationStep) * editorSettings.rotationStep;
    element.rotation = ((snappedAngle + 180) % 360 + 360) % 360 - 180;
  } else if (drag.mode === "text-width") {
    activeGuides = [];
    const localPoint = pointInElementSpace(point, drag.original);
    const resizeFromLeft = drag.handle === "text-w";
    const fixedX = resizeFromLeft ? drag.original.x + drag.original.w : drag.original.x;
    element.w = Math.max(editorSettings.gridSize * 3, snap(Math.abs(localPoint.x - fixedX)));
    element.x = snap(resizeFromLeft ? fixedX - element.w : fixedX);
    updateTextHeight(element);
  } else {
    activeGuides = [];
    resizeFromCorner(element, drag.original, drag.handle, point);
  }
  syncUI();
});

function finishCanvasDrag() {
  drag = null;
  canvas.style.cursor = "default";
  if (activeGuides.length) {
    activeGuides = [];
    render();
  }
}
canvas.addEventListener("pointerup", finishCanvasDrag);
canvas.addEventListener("pointercancel", finishCanvasDrag);

const commitTextEdit = () => {
  if (pendingTextSnapshot && pendingTextSnapshot !== projectSnapshot()) saveUndoSnapshot(pendingTextSnapshot);
  pendingTextSnapshot = null;
};

function closeContextMenu() {
  ui.contextMenu.hidden = true;
}

function refreshContextMenu() {
  const item = currentItem();
  if (!item) { closeContextMenu(); return; }
  ui.contextMenu.hidden = false;
  const isText = item.type === "text";
  const isGridCell = item.kind === "leaf";
  ui.contextLabel.textContent = isGridCell ? "Vlak" : item.type === "circle" ? "Cirkel" : item.type === "text" ? "Tekst" : "Vlak";
  setPressedSwatch(ui.contextSwatches, item.fill);
  ui.contextEditText.hidden = !isText;
  ui.contextTextControls.hidden = !isText;
  ui.contextActions.hidden = isGridCell;
  if (isText) {
    const closest = [40, 80, 160, 240].reduce((a, b) => Math.abs(b - item.fontSize) < Math.abs(a - item.fontSize) ? b : a);
    ui.contextFontSize.value = String(closest);
    setPressedValue(ui.contextTextAlign, item.textAlign || "left");
    setPressedValue(ui.contextTextVerticalAlign, item.verticalAlign || "top");
    ui.contextRotationInput.value = String(item.rotation || 0);
  }
}

function positionInlineTextEditor() {
  const item = currentFrame().elements.find((element) => element.id === editingTextId);
  if (!item) return;
  const canvasRect = canvas.getBoundingClientRect();
  const stageRect = stage.getBoundingClientRect();
  const scaleX = canvasRect.width / canvasSize.width;
  const scaleY = canvasRect.height / canvasSize.height;
  const contentHeight = wrappedTextLines(item).length * item.fontSize * 1.12;
  const verticalOffset = item.verticalAlign === "middle"
    ? Math.max(0, (item.h - contentHeight) / 2)
    : item.verticalAlign === "bottom" ? Math.max(0, item.h - contentHeight) : 0;
  Object.assign(ui.inlineTextEditor.style, {
    left: `${canvasRect.left - stageRect.left + item.x * scaleX}px`,
    top: `${canvasRect.top - stageRect.top + item.y * scaleY}px`,
    width: `${Math.max(60, item.w * scaleX)}px`,
    height: `${Math.max(36, item.h * scaleY)}px`,
    color: item.fill,
    fontSize: `${Math.max(12, item.fontSize * scaleY)}px`,
    textAlign: item.textAlign || "left",
    paddingTop: `${verticalOffset * scaleY}px`,
    transform: `rotate(${item.rotation || 0}deg)`,
  });
}

function openInlineTextEditor(item = currentItem()) {
  if (item?.type !== "text") return;
  editingTextId = item.id;
  pendingTextSnapshot = projectSnapshot();
  ui.inlineTextEditor.value = item.text;
  ui.inlineTextEditor.hidden = false;
  positionInlineTextEditor();
  render();
  ui.inlineTextEditor.focus();
}

function closeInlineTextEditor(commit = true) {
  if (!editingTextId) return;
  if (commit) commitTextEdit();
  else pendingTextSnapshot = null;
  editingTextId = null;
  ui.inlineTextEditor.hidden = true;
  render();
}

function setSelectedTextRotation(value) {
  const item = currentItem();
  if (item?.type !== "text") return;
  const snapped = Math.round((Number(value) || 0) / editorSettings.rotationStep) * editorSettings.rotationStep;
  const rotation = ((snapped + 180) % 360 + 360) % 360 - 180;
  if (rotation === (item.rotation || 0)) return;
  saveUndoSnapshot();
  item.rotation = rotation;
  if (editingTextId === item.id) positionInlineTextEditor();
  refreshContextMenu();
  render();
}

canvas.addEventListener("dblclick", (event) => {
  const item = elementAt(canvasPoint(event));
  if (item?.type === "text") {
    selectedElementId = item.id;
    syncUI();
    openInlineTextEditor(item);
  }
});

ui.inlineTextEditor.addEventListener("input", () => {
  const item = currentFrame().elements.find((element) => element.id === editingTextId);
  if (!item) return;
  item.text = ui.inlineTextEditor.value;
  updateTextHeight(item);
  positionInlineTextEditor();
  render();
});
ui.inlineTextEditor.addEventListener("blur", () => closeInlineTextEditor(true));
ui.inlineTextEditor.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    ui.inlineTextEditor.blur();
  }
});

ui.contextEditText.addEventListener("click", () => openInlineTextEditor());
ui.contextFontSize.addEventListener("change", () => {
  const item = currentItem();
  if (item?.type !== "text") return;
  saveUndoSnapshot();
  item.fontSize = Number(ui.contextFontSize.value);
  updateTextHeight(item);
  refreshContextMenu();
  render();
});
function applyTextAlignment(container, property, event) {
  const button = event.target.closest("button[data-value]");
  if (!button || !container.contains(button)) return;
  const item = currentItem();
  if (item?.type !== "text") return;
  if (item[property] === button.dataset.value) return;
  saveUndoSnapshot();
  item[property] = button.dataset.value;
  setPressedValue(container, button.dataset.value);
  if (editingTextId === item.id) positionInlineTextEditor();
  render();
}
ui.contextTextAlign.addEventListener("click", (event) => applyTextAlignment(ui.contextTextAlign, "textAlign", event));
ui.contextTextVerticalAlign.addEventListener("click", (event) => applyTextAlignment(ui.contextTextVerticalAlign, "verticalAlign", event));
ui.contextRotationInput.addEventListener("change", () => setSelectedTextRotation(ui.contextRotationInput.value));
ui.contextRotationInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  setSelectedTextRotation(ui.contextRotationInput.value);
  ui.contextRotationInput.blur();
});
ui.contextDuplicate.addEventListener("click", () => { duplicateSelectedElement(); refreshContextMenu(); });
ui.contextDelete.addEventListener("click", () => { deleteSelectedElement(); closeContextMenu(); });

stage.addEventListener("pointerdown", (event) => {
  if (event.target !== stage) return;
  closeInlineTextEditor(true);
  selectedElementId = null;
  syncUI();
});

ui.mode.addEventListener("change", () => changeMode(ui.mode.value));
ui.duration.addEventListener("change", () => {
  saveUndoSnapshot();
  currentFrame().duration = Math.min(10000, Math.max(100, Number(ui.duration.value) || 800));
  syncUI();
});
$("#add-circle").addEventListener("click", () => addElement("circle"));
$("#add-rect").addEventListener("click", () => addElement("rect"));
$("#add-text").addEventListener("click", () => addElement("text"));
ui.splitHorizontal.addEventListener("click", () => splitSelectedCell("horizontal"));
ui.splitVertical.addEventListener("click", () => splitSelectedCell("vertical"));
ui.mergeCell.addEventListener("click", mergeSelectedCell);
$("#add-keyframe").addEventListener("click", addKeyframe);
ui.removeKeyframe.addEventListener("click", removeKeyframe);
ui.play.addEventListener("click", () => isPlaying ? stopPlayback() : playAnimation());

document.querySelectorAll(".section-heading").forEach((button) => {
  button.addEventListener("click", () => {
    const section = button.closest(".panel-section");
    const collapsed = section.classList.toggle("collapsed");
    button.setAttribute("aria-expanded", String(!collapsed));
    button.querySelector(".collapse-symbol").textContent = collapsed ? "+" : "−";
  });
});

function resizeCanvas() {
  stopPlayback();
  const oldWidth = canvasSize.width;
  const oldHeight = canvasSize.height;
  const newWidth = Math.min(4096, Math.max(240, Number(ui.width.value) || oldWidth));
  const newHeight = Math.min(4096, Math.max(240, Number(ui.height.value) || oldHeight));
  if (newWidth === oldWidth && newHeight === oldHeight) return;
  saveUndoSnapshot();
  keyframes.forEach((frame) => {
    scaleFreeform(frame, oldWidth, oldHeight, newWidth, newHeight);
    if (frame.mode === "grid") alignGridDividers(frame.grid, 0, 0, newWidth, newHeight);
  });
  setCanvasDimensions(newWidth, newHeight);
  ui.width.value = newWidth;
  ui.height.value = newHeight;
  fitCanvas();
  syncUI();
}
ui.width.addEventListener("change", resizeCanvas);
ui.height.addEventListener("change", resizeCanvas);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

$("#export-png").addEventListener("click", () => {
  closeInlineTextEditor(true);
  render(false);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `cqp-keyframe-${selectedFrame + 1}.png`);
    ui.exportStatus.textContent = "PNG geëxporteerd";
    setTimeout(() => { ui.exportStatus.textContent = ""; }, 2200);
    render();
  }, "image/png");
});

$("#export-video").addEventListener("click", async () => {
  closeInlineTextEditor(true);
  if (keyframes.length < 2) { ui.exportStatus.textContent = "Voeg eerst een keyframe toe"; return; }
  if (!canvas.captureStream || typeof MediaRecorder === "undefined") { ui.exportStatus.textContent = "Video-export wordt hier niet ondersteund"; return; }
  const types = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mimeType = types.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) { ui.exportStatus.textContent = "Geen ondersteund videoformaat"; return; }
  recordedChunks = [];
  const stream = canvas.captureStream(60);
  try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12_000_000 }); }
  catch { ui.exportStatus.textContent = "Export kon niet starten"; return; }
  recorder.addEventListener("dataavailable", (event) => { if (event.data.size) recordedChunks.push(event.data); });
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  recorder.start();
  ui.exportStatus.textContent = "Video wordt gemaakt…";
  await playAnimation();
  render(false);
  if (recorder.state === "recording") recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  downloadBlob(new Blob(recordedChunks, { type: mimeType }), `cqp-animatie.${extension}`);
  ui.exportStatus.textContent = extension === "mp4" ? "MP4 geëxporteerd" : "Browser exporteerde WebM";
  recorder = null;
});

function moveSelectedLayer(toFront) {
  const frame = currentFrame();
  const index = frame.elements.findIndex((item) => item.id === selectedElementId);
  if (index < 0) return;
  const targetIndex = toFront ? frame.elements.length - 1 : 0;
  if (index === targetIndex) return;
  saveUndoSnapshot();
  const [item] = frame.elements.splice(index, 1);
  if (toFront) frame.elements.push(item);
  else frame.elements.unshift(item);
  render();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (editingTextId) closeInlineTextEditor(true);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (pendingTextSnapshot) {
      saveUndoSnapshot(pendingTextSnapshot);
      pendingTextSnapshot = null;
    }
    undo();
    return;
  }
  if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
  const shortcutKey = event.ctrlKey || event.metaKey;
  if (shortcutKey && event.key.toLowerCase() === "c") {
    if (copySelectedElement()) event.preventDefault();
    return;
  }
  if (shortcutKey && event.key.toLowerCase() === "v") {
    if (pasteCopiedElement()) event.preventDefault();
    return;
  }
  const frame = currentFrame();
  const item = currentItem();
  if (!item || isPlaying || item.kind === "leaf") return;
  if (event.key === "]") {
    event.preventDefault();
    moveSelectedLayer(true);
    return;
  }
  if (event.key === "[") {
    event.preventDefault();
    moveSelectedLayer(false);
    return;
  }
  if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    deleteSelectedElement();
    return;
  }
  const amount = editorSettings.gridSize * (event.shiftKey ? 5 : 1);
  const changes = { ArrowLeft: [-amount, 0], ArrowRight: [amount, 0], ArrowUp: [0, -amount], ArrowDown: [0, amount] };
  if (changes[event.key]) {
    event.preventDefault();
    saveUndoSnapshot();
    item.x += changes[event.key][0];
    item.y += changes[event.key][1];
    render();
  }
});

window.addEventListener("resize", fitCanvas);
new ResizeObserver(fitCanvas).observe(stage);
syncUI();
const initialPaint = () => { fitCanvas(); render(); };
if (document.readyState === "complete") initialPaint();
else window.addEventListener("load", initialPaint, { once: true });
document.fonts?.load('500 80px "Jokker"').then(initialPaint);
requestAnimationFrame(() => requestAnimationFrame(initialPaint));
setTimeout(initialPaint, 120);
