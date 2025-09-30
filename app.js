const GUEST_PLAN_CACHE_KEY = 'flowSeat:lastPublishedPlan';
const globalConfig = window.__FLOWSEAT_CONFIG ?? {};
const BASE_URL = globalConfig.baseUrl ?? window.location.origin;

export const guestPlanStorage = {
  key: GUEST_PLAN_CACHE_KEY,
  save(plan) {
    persistGuestFacingSnapshot(plan);
  },
  load(planId) {
    try {
      const store = JSON.parse(localStorage.getItem(GUEST_PLAN_CACHE_KEY) ?? '{}');
      return store[planId] ?? null;
    } catch (error) {
      console.error('Failed to load guest snapshot', error);
      return null;
    }
  },
};

function renderPublishSummary(current) {
  if (!selectors.publishEventName) return;

  selectors.publishEventName.textContent = current.name || 'Untitled event';
  selectors.publishEventDate.textContent = current.date ? formatDate(current.date) : 'Draft';
  selectors.publishEventVenue.textContent = current.venue || 'TBD';

  const reservedSeats = current.layout.elements.reduce((total, element) => {
    const seatCapacity = Number.isFinite(element.capacity) ? element.capacity : element.guests?.length ?? 0;
    if (element.status === 'reserved') {
      return total + seatCapacity;
    }
    if (Array.isArray(element.guests) && element.guests.length) {
      return total + element.guests.length;
    }
    return total;
  }, 0);

  selectors.publishEventReserved.textContent = `${reservedSeats}`;

  const url = current.shareUrl ?? '';
  const shareInput = selectors.publishShareUrl;
  const status = selectors.publishShareStatus;
  const copyButton = selectors.copyShareUrl;

  if (shareInput) {
    shareInput.value = url || 'Generate a link to share with guests';
  }

  if (status) {
    status.textContent = url ? 'Share link ready' : 'Link not generated yet';
    status.dataset.tone = url ? 'success' : 'muted';
  }

  if (copyButton) {
    copyButton.disabled = !url;
  }
}

function renderPublishPreview(current) {
  if (!selectors.publishPreview) return;

  selectors.publishPreview.innerHTML = '';

  const previewCanvas = document.createElement('canvas');
  previewCanvas.width = 640;
  previewCanvas.height = 360;
  previewCanvas.className = 'publish-preview__image';

  const context = previewCanvas.getContext('2d');
  if (!context) {
    const fallback = document.createElement('div');
    fallback.className = 'publish-preview__empty';
    fallback.textContent = 'Preview unavailable in this browser.';
    selectors.publishPreview.appendChild(fallback);
    persistGuestFacingSnapshot(current);
    return;
  }

  context.fillStyle = '#f0f2f5';
  context.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

  const padding = 40;
  const contentWidth = previewCanvas.width - padding * 2;
  const contentHeight = previewCanvas.height - padding * 2;

  const elements = current.layout.elements;
  if (!elements.length) {
    const empty = document.createElement('div');
    empty.className = 'publish-preview__empty';
    empty.textContent = 'Add seats to generate a preview.';
    selectors.publishPreview.appendChild(empty);
    persistGuestFacingSnapshot(current);
    return;
  }

  const positions = elements.map((el) => ({
    minX: el.position.x,
    minY: el.position.y,
    maxX: el.position.x + el.dimensions.width,
    maxY: el.position.y + el.dimensions.height,
  }));

  const minX = Math.min(...positions.map((pos) => pos.minX));
  const minY = Math.min(...positions.map((pos) => pos.minY));
  const maxX = Math.max(...positions.map((pos) => pos.maxX));
  const maxY = Math.max(...positions.map((pos) => pos.maxY));

  const scaleX = contentWidth / Math.max(maxX - minX, 1);
  const scaleY = contentHeight / Math.max(maxY - minY, 1);
  const scale = Math.min(scaleX, scaleY);

  context.translate(padding, padding);
  context.scale(scale, scale);
  context.translate(-minX, -minY);

  elements.forEach((element) => {
    drawPreviewElement(context, element, scale);
  });

  selectors.publishPreview.appendChild(previewCanvas);
  persistGuestFacingSnapshot(current);
}

function drawPreviewElement(context, element, scale) {
  context.save();

  const { position, dimensions } = element;
  const centerX = position.x + dimensions.width / 2;
  const centerY = position.y + dimensions.height / 2;

  context.translate(centerX, centerY);
  context.rotate(((element.rotation ?? 0) * Math.PI) / 180);
  context.translate(-centerX, -centerY);

  const palette = resolvePreviewColors(element);
  const strokeWidth = Math.max(1, 2 / scale);
  context.lineWidth = strokeWidth;
  context.strokeStyle = palette.stroke;
  context.fillStyle = palette.fill;
  context.lineJoin = 'round';
  context.lineCap = 'round';

  const { x, y } = position;
  const { width, height } = dimensions;

  if (element.type === 'seat') {
    const radius = Math.max(Math.min(width, height) / 2 - strokeWidth, 4 / scale);
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();
  } else if (element.type === 'table') {
    drawRoundedRect(context, x, y, width, height, Math.min(18, Math.min(width, height) / 3));
  } else if (element.type === 'sofa') {
    drawRoundedRect(context, x, y, width, height, Math.min(22, Math.min(width, height) / 2.5));
  } else if (element.type === 'stage') {
    drawRoundedRect(context, x, y, width, height, 12);
  } else {
    drawRoundedRect(context, x, y, width, height, 10);
  }

  const label = resolvePreviewLabel(element);
  if (label) {
    context.fillStyle = palette.text;
    context.font = `${Math.max(10, Math.min(width, height) / 3) / scale}px "Inter", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, centerX, centerY);
  }

  context.restore();
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
  context.fill();
  context.stroke();
}

const PREVIEW_SEAT_STATUS = {
  open: {
    fill: '#dcfce7',
    stroke: '#86efac',
    text: '#166534',
  },
  reserved: {
    fill: '#fee2e2',
    stroke: '#fca5a5',
    text: '#b91c1c',
  },
  blocked: {
    fill: '#f3f4f6',
    stroke: '#d1d5db',
    text: '#475467',
  },
  occupied: {
    fill: 'rgba(249, 115, 22, 0.16)',
    stroke: 'rgba(234, 88, 12, 0.55)',
    text: '#9a3412',
  },
  vip: {
    fill: 'rgba(139, 92, 246, 0.2)',
    stroke: 'rgba(139, 92, 246, 0.55)',
    text: '#6d28d9',
  },
  default: {
    fill: 'rgba(165, 108, 55, 0.18)',
    stroke: 'rgba(165, 108, 55, 0.6)',
    text: '#3f2a16',
  },
};

const PREVIEW_ELEMENT_DEFAULTS = {
  table: {
    fill: 'rgba(148, 163, 184, 0.28)',
    stroke: 'rgba(100, 116, 139, 0.65)',
    text: '#1f2937',
  },
  sofa: {
    fill: 'rgba(244, 114, 182, 0.18)',
    stroke: 'rgba(244, 114, 182, 0.5)',
    text: '#831843',
  },
  stage: {
    fill: 'rgba(125, 211, 252, 0.2)',
    stroke: 'rgba(14, 165, 233, 0.6)',
    text: '#0c4a6e',
  },
  default: {
    fill: 'rgba(226, 232, 240, 0.6)',
    stroke: 'rgba(148, 163, 184, 0.7)',
    text: '#1f2937',
  },
};

function resolvePreviewColors(element) {
  if (element.type === 'seat') {
    const hasVipTag = element.tags?.some((tag) => tag?.toString().toUpperCase() === 'VIP');
    if (hasVipTag) {
      return PREVIEW_SEAT_STATUS.vip;
    }
    const statusKey = (element.status ?? 'default').toLowerCase();
    return PREVIEW_SEAT_STATUS[statusKey] ?? PREVIEW_SEAT_STATUS.default;
  }

  const defaults = PREVIEW_ELEMENT_DEFAULTS[element.type] ?? PREVIEW_ELEMENT_DEFAULTS.default;
  const statusKey = (element.status ?? '').toLowerCase();
  if (statusKey && PREVIEW_SEAT_STATUS[statusKey]) {
    return {
      fill: PREVIEW_SEAT_STATUS[statusKey].fill,
      stroke: PREVIEW_SEAT_STATUS[statusKey].stroke,
      text: PREVIEW_SEAT_STATUS[statusKey].text,
    };
  }
  return defaults;
}

function resolvePreviewLabel(element) {
  return '';
}
function captureElementsOrigin(ids) {
  const current = ensureEvent();
  if (!current) return {};
  const origin = {};
  ids.forEach((id) => {
    const element = current.layout.elements.find((el) => el.id === id);
    if (element) {
      origin[id] = {
        x: element.position.x,
        y: element.position.y,
        width: element.dimensions.width,
        height: element.dimensions.height,
      };
    }
  });
  return origin;
}

function translateSelection(ids, delta, options = {}) {
  const current = ensureEvent();
  if (!current) return;
  const { snap = 10 } = options;
  const bounds = getVisibleCanvasBounds();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  ids.forEach((id) => {
    const origin = state.multiSelect.dragState?.origin?.[id];
    if (!origin) return;
    minX = Math.min(minX, origin.x);
    minY = Math.min(minY, origin.y);
    maxX = Math.max(maxX, origin.x + origin.width);
    maxY = Math.max(maxY, origin.y + origin.height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const clampedDelta = {
    x: clamp(minX + delta.x, bounds.minX, Math.max(bounds.minX, bounds.maxX - width)) - minX,
    y: clamp(minY + delta.y, bounds.minY, Math.max(bounds.minY, bounds.maxY - height)) - minY,
  };

  ids.forEach((id) => {
    const element = current.layout.elements.find((el) => el.id === id);
    const origin = state.multiSelect.dragState?.origin?.[id];
    if (!element || !origin) return;

    element.position.x = Math.round((origin.x + clampedDelta.x) / snap) * snap;
    element.position.y = Math.round((origin.y + clampedDelta.y) / snap) * snap;

    clampElementToCanvas(element);
    const node = selectors.canvas.querySelector(`[data-id="${id}"]`);
    if (node) decorateElementNode(node, element);
  });
}

function handleMultiDragMove(event) {
  if (!state.multiSelect.dragState) return;

  const bounds = getVisibleCanvasBounds();
  const point = screenToStagePoint(event.clientX, event.clientY);
  const clampedPoint = {
    x: clamp(point.x, bounds.minX, bounds.maxX),
    y: clamp(point.y, bounds.minY, bounds.maxY),
  };

  const delta = {
    x: clampedPoint.x - state.multiSelect.dragState.start.x,
    y: clampedPoint.y - state.multiSelect.dragState.start.y,
  };

  state.multiSelect.translate = delta;
  translateSelection(state.selectedSeatIds, delta, { snap: event.shiftKey ? 1 : 10 });
  state.multiSelect.hasDragged = true;
}

function finalizeMultiDrag(pointerId) {
  if (!state.multiSelect.dragState) return;
  if (pointerId !== undefined && selectors.canvas?.releasePointerCapture) {
    try {
      selectors.canvas.releasePointerCapture(pointerId);
    } catch (error) {
      // ignore
    }
  }

  state.multiSelect.dragState = null;
  state.multiSelect.translate = null;
  state.multiSelect.anchor = null;
  state.multiSelect.current = null;
  state.multiSelect.dragging = false;
  state.multiSelect.hasDragged = false;
  state.multiSelect.pointerId = null;
  selectors.selectionOverlay?.remove();
  selectors.selectionOverlay = null;
  state.selectionPreview = [];
  persist();
  state.suppressCanvasClear = true;
  renderSeatDetails();
}

import { authClient } from './supabase.js';

const supabase = authClient.client;

const STAGE_MIN_SIZE = { width: 2800, height: 1800 };
const STAGE_EXPAND_MARGIN = 320;
const SITE_UNIT_SCALES = {
  m: 50,
};
const DEFAULT_SITE_DIMENSIONS = Object.freeze({ width: 48, height: 32, unit: 'm' });
const DEFAULT_SITE_PIXELS = {
  width: DEFAULT_SITE_DIMENSIONS.width * (SITE_UNIT_SCALES[DEFAULT_SITE_DIMENSIONS.unit] ?? 1),
  height: DEFAULT_SITE_DIMENSIONS.height * (SITE_UNIT_SCALES[DEFAULT_SITE_DIMENSIONS.unit] ?? 1),
};
const ZOOM_LIMITS = { min: 1, max: 1 };
const ZOOM_WHEEL_FACTOR = 1.06;
const PLAN_SYNC_DELAY = 1000;
const SUPABASE_WARNING_INTERVAL = 30000;

let lastSupabaseWarning = 0;

function createInitialMultiSelectState() {
  return {
    active: false,
    anchor: null,
    current: null,
    previousSelection: [],
    hasDragged: false,
    dragging: false,
    pointerId: null,
    lastPointerDown: 0,
    translate: null,
    dragState: null,
  };
}

const state = {
  events: [],
  selectedEventId: null,
  selectedSeatId: null,
  selectedSeatIds: [],
  selectionPreview: [],
  multiSelect: createInitialMultiSelectState(),
  suppressCanvasClear: false,
  currentTool: 'select',
  currentIntent: 'layout',
  zoom: 1,
  viewport: {
    pan: { x: 0, y: 0 },
    offset: { x: STAGE_EXPAND_MARGIN, y: STAGE_EXPAND_MARGIN },
    size: { ...STAGE_MIN_SIZE },
    initialized: false,
    bounds: null,
  },
  liveMode: false,
  syncing: false,
  dragState: null,
  lastCanvasPoint: null,
  clipboard: null,
  rotationHandle: {
    active: false,
    elementId: null,
    dragging: false,
    angle: 0,
  },
  contextMenu: {
    visible: false,
    elementId: null,
    position: { x: 0, y: 0 },
  },
  auth: {
    user: null,
  },
  form: {
    isDirty: false,
    isHydrating: false,
    lastHydratedEventId: null,
  },
};

const selectors = {
  chips: document.querySelectorAll('.chip[data-intent]'),
  toolButtons: document.querySelectorAll('[data-tool]'),
  sidebar: document.querySelector('.sidebar'),
  sidebarOpen: document.querySelector("[data-action='openSidebar']"),
  sidebarClose: document.querySelector("[data-action='closeSidebar']"),
  leftPanelToggle: document.querySelector("[data-action='toggleLeftPanel']"),
  rightPanelToggle: document.querySelector("[data-action='toggleRightPanel']"),
  canvas: document.querySelector('#seatingCanvas'),
  viewport: document.querySelector('[data-viewport]'),
  stage: document.querySelector('[data-stage]'),
  scale: document.querySelector('[data-scale]'),
  layer: document.querySelector('[data-layer]'),
  emptyState: document.querySelector('#canvasEmpty'),
  eventList: document.querySelector('#eventList'),
  eventForm: document.querySelector('#eventForm'),
  eventName: document.querySelector('#eventName'),
  eventDate: document.querySelector('#eventDate'),
  eventVenue: document.querySelector('#eventVenue'),
  eventCapacity: document.querySelector('#eventCapacity'),
  deleteAllEvents: document.querySelector('#deleteAllEvents'),
  currentEventName: document.querySelector('#currentEventName'),
  guestList: document.querySelector('#guestList'),
  seatDetails: document.querySelector('#seatDetails'),
  selectionPanel: document.querySelector('[data-selection-panel]'),
  toastStack: document.querySelector('#toastStack'),
  importModal: document.querySelector('#importModal'),
  importGuests: document.querySelector('#importGuests'),
  clearSelection: document.querySelector('#clearSelection'),
  balanceTables: document.querySelector('#balanceTables'),
  deleteElement: null,
  duplicateElementBtn: null,
  zoomIn: document.querySelector('#zoomIn'),
  zoomOut: document.querySelector('#zoomOut'),
  zoomReset: document.querySelector('#zoomReset'),
  syncStatus: document.querySelector('#syncStatus'),
  loginOverlay: document.querySelector('#loginOverlay'),
  loginCard: document.querySelector('#loginCard'),
  googleLogin: document.querySelector('#googleLogin'),
  loginHint: document.querySelector('#loginHint'),
  loginError: document.querySelector('#loginError'),
  logoutButton: document.querySelector('#logoutButton'),
  editToolbar: document.querySelector('.edit-toolbar'),
  rotationInput: document.querySelector('#rotationAngleInput'),
  rotateButton: document.querySelector('[data-edit-action="rotate"]'),
  handleButton: document.querySelector('[data-edit-action="toggle-handle"]'),
  copyButton: document.querySelector('[data-edit-action="copy"]'),
  pasteButton: document.querySelector('[data-edit-action="paste"]'),
  duplicateButton: document.querySelector('[data-edit-action="duplicate"]'),
  deleteButton: document.querySelector('[data-edit-action="delete"]'),
  bringFrontButton: document.querySelector('[data-edit-action="bring-front"]'),
  sendBackButton: document.querySelector('[data-edit-action="send-back"]'),
  workspaceBody: document.querySelector('.workspace-body'),
  assignmentsPanel: document.querySelector('[data-assignments-panel]'),
  assignmentsEvent: document.querySelector('[data-assignments-event]'),
  assignmentsSummary: document.querySelector('[data-assignments-summary]'),
  assignmentsProgress: document.querySelector('[data-assignments-progress]'),
  assignmentsFeed: document.querySelector('[data-assignments-feed]'),
  assignmentsUpdated: document.querySelector('[data-assignments-updated]'),
  assignmentsMapSection: document.querySelector('[data-assignments-map]'),
  assignmentsMapCanvas: document.querySelector('#assignmentsMapCanvas'),
  assignmentsMapOverlay: document.querySelector('[data-assignments-map-overlay]'),
  assignmentsMapAvailable: document.querySelector('[data-assignments-map-available]'),
  assignmentsMapReserved: document.querySelector('[data-assignments-map-reserved]'),
  assignmentsMapTotal: document.querySelector('[data-assignments-map-total]'),
  assignmentsMapSection: document.querySelector('[data-assignments-map]'),
  assignmentsMapCanvas: document.querySelector('#assignmentsMapCanvas'),
  assignmentsMapOverlay: document.querySelector('[data-assignments-map-overlay]'),
  assignmentsMapAvailable: document.querySelector('[data-assignments-map-available]'),
  assignmentsMapReserved: document.querySelector('[data-assignments-map-reserved]'),
  assignmentsMapTotal: document.querySelector('[data-assignments-map-total]'),
  refreshAssignments: document.querySelector('[data-action="refreshAssignments"]'),
  contextMenu: document.querySelector('#elementContextMenu'),
  selectionOverlay: null,
  openEventDatePicker: document.querySelector('#openEventDatePicker'),
  capacityStepperButtons: document.querySelectorAll('[data-capacity-step]'),
  openEventDatePicker: document.querySelector('#eventDateTrigger'),
  eventDateDisplay: document.querySelector('#eventDateDisplay'),
  eventDateNative: document.querySelector('#eventDate'),
  publishButton: document.querySelector('#openPublishModal'),
  publishModal: document.querySelector('#publishModal'),
  publishPreview: document.querySelector('#publishPreview'),
  publishEventName: document.querySelector('#publishEventName'),
  publishEventDate: document.querySelector('#publishEventDate'),
  publishEventVenue: document.querySelector('#publishEventVenue'),
  publishEventReserved: document.querySelector('#publishEventReserved'),
  publishShareUrl: document.querySelector('#publishShareUrl'),
  publishShareStatus: document.querySelector('#publishShareStatus'),
  copyShareUrl: document.querySelector('#copyShareUrl'),
  regenerateShareLink: document.querySelector('#regenerateShareLink'),
  confirmPublish: document.querySelector('#confirmPublish'),
  publishConfirmModal: document.querySelector('#publishConfirmModal'),
  finalizePublish: document.querySelector('#finalizePublish'),
};

if (selectors.contextMenu) {
  selectors.contextMenu.originalContent = createElementContextMenuMarkup();
  selectors.contextMenu.innerHTML = selectors.contextMenu.originalContent;
}

const EDIT_ACTIONS = {
  ROTATE: 'rotate',
  TOGGLE_HANDLE: 'toggle-handle',
  COPY: 'copy',
  PASTE: 'paste',
  DUPLICATE: 'duplicate',
  DELETE: 'delete',
  BRING_FRONT: 'bring-front',
  SEND_BACK: 'send-back',
};

const ROTATION_HANDLE_PADDING = 56;
const ROTATION_HANDLE_MIN_RADIUS = 120;
const CLONE_OFFSETS = {
  paste: { x: 24, y: 24 },
  duplicate: { x: 32, y: 32 },
};
const RESET_TO_OPEN_TYPES = new Set(['seat', 'table', 'sofa']);

const rotationOverlay = {
  container: null,
  svg: null,
  circle: null,
  line: null,
  handle: null,
  label: null,
};

const shortcutState = {
  meta: false,
  ctrl: false,
  shift: false,
};

const STORAGE_VERSION = 'v2';
const STORAGE_NAMESPACE = 'flowseat-state';
const LAYOUT_NAMESPACE = 'flowseat-layout-state';
const storageKeyBase = `${STORAGE_NAMESPACE}-${STORAGE_VERSION}`;
const layoutStorageKeyBase = `${LAYOUT_NAMESPACE}-${STORAGE_VERSION}`;
const panelState = {
  left: 'expanded',
  right: 'collapsed',
};

let activePlanMenu = null;

init();

const remoteSyncState = {
  timer: null,
  pendingDeletes: new Set(),
  loadedIds: new Set(),
  planTimers: new Map(),
};

function setSyncIndicator(active) {
  if (state.syncing === active) return;
  state.syncing = active;
  renderSyncStatus();
}

function schedulePlanSync(planId, options = {}) {
  if (!planId || !supabase) return;
  const { immediate = false } = options;

  if (!state.events.some((plan) => plan.id === planId)) return;

  setSyncIndicator(true);

  if (remoteSyncState.planTimers.has(planId)) {
    clearTimeout(remoteSyncState.planTimers.get(planId));
  }

  const flush = async () => {
    remoteSyncState.planTimers.delete(planId);
    const plan = state.events.find((entry) => entry.id === planId);
    if (!plan) {
      if (!remoteSyncState.planTimers.size) setSyncIndicator(false);
      return;
    }

    try {
      await pushPlanToSupabase(planId, plan);
    } catch (error) {
      console.error('Scheduled plan sync failed', error);
      toast('Could not save the plan', { tone: 'error' });
    } finally {
      if (!remoteSyncState.planTimers.size) setSyncIndicator(false);
    }
  };

  if (immediate) {
    flush();
    return;
  }

  const timer = setTimeout(flush, PLAN_SYNC_DELAY);
  remoteSyncState.planTimers.set(planId, timer);
}

function cancelPlanSync(planId) {
  if (!planId) return;
  const timer = remoteSyncState.planTimers.get(planId);
  if (timer) {
    clearTimeout(timer);
    remoteSyncState.planTimers.delete(planId);
  }
  if (!remoteSyncState.planTimers.size) setSyncIndicator(false);
}

function cancelAllPlanSyncs() {
  remoteSyncState.planTimers.forEach((timer) => clearTimeout(timer));
  remoteSyncState.planTimers.clear();
  setSyncIndicator(false);
}

async function init() {
  bindUI();
  const session = await authClient.bootstrap(handleSessionHydration);
  hydrate();
  render();
  if (session && supabase) {
    await loadPlans();
  }
}

function bindUI() {
  selectors.chips.forEach((chip) =>
    chip.addEventListener('click', () => setIntent(chip.dataset.intent))
  );

  selectors.toolButtons.forEach((btn) =>
    btn.addEventListener('click', () => handleToolClick(btn.dataset.tool))
  );

  bindEditToolbar();
  bindContextMenu();
  bindKeyboardShortcuts();

  selectors.eventForm.addEventListener('submit', handleCreateEvent);
  selectors.deleteAllEvents?.addEventListener('click', handleDeleteAllEvents);
  selectors.clearSelection.addEventListener('click', clearSeatSelection);
  selectors.deleteElement?.addEventListener('click', () => {
    if (state.selectedSeatId) {
      deleteElement(state.selectedSeatId);
    }
  });
  selectors.balanceTables.addEventListener('click', handleBalanceTables);
  document
    .querySelector('[data-action="clearLayout"]')
    ?.addEventListener('click', handleClearLayout);

  selectors.importGuests.addEventListener('click', openImportModal);
  selectors.importModal
    .querySelector('[data-action="closeModal"]')
    .addEventListener('click', closeImportModal);
  selectors.importModal
    .querySelector('#confirmImport')
    .addEventListener('click', confirmImport);

  selectors.zoomIn?.setAttribute('disabled', 'true');
  selectors.zoomOut?.setAttribute('disabled', 'true');
  selectors.zoomReset?.setAttribute('disabled', 'true');


  selectors.canvas.addEventListener('click', handleCanvasClick);
  selectors.canvas.addEventListener('pointerdown', handlePointerDown);
  selectors.canvas.addEventListener('pointermove', handlePointerMove);
  selectors.canvas.addEventListener('pointerup', handlePointerUp);
  selectors.canvas.addEventListener('pointerleave', handlePointerUp);
  selectors.canvas.addEventListener('contextmenu', handleCanvasContextMenu);
  selectors.canvas.addEventListener('pointerdown', unlockOnFirstInteraction, {
    once: true,
    capture: true,
  });
  selectors.canvas.tabIndex = 0;
  selectors.viewport?.addEventListener('pointermove', trackCanvasPoint);
  selectors.viewport?.addEventListener('wheel', handleViewportWheel, {
    passive: false,
  });

  selectors.refreshAssignments?.addEventListener('click', () => {
    renderAssignments();
    toast('Assignments refreshed');
  });

  selectors.sidebarOpen?.addEventListener('click', () => toggleSidebar(true));
  selectors.sidebarClose?.addEventListener('click', () => toggleSidebar(false));
  selectors.leftPanelToggle?.addEventListener('click', toggleLeftPanel);
  selectors.rightPanelToggle?.addEventListener('click', toggleRightPanel);

  window.matchMedia('(min-width: 769px)').addEventListener('change', () =>
    toggleSidebar(false)
  );

  selectors.googleLogin?.addEventListener('click', handleGoogleSignIn);
  selectors.logoutButton?.addEventListener('click', handleLogout);
  selectors.openEventDatePicker?.addEventListener('click', openDatePicker);
  selectors.eventDateNative?.addEventListener('change', updateDateDisplay);
  selectors.eventDateNative?.addEventListener('input', updateDateDisplay);
  selectors.capacityStepperButtons?.forEach((button) =>
    button.addEventListener('click', handleCapacityStep)
  );
  selectors.eventCapacity?.addEventListener('input', sanitizeCapacityInput);
  selectors.eventCapacity?.addEventListener('blur', enforceCapacityBounds);
  selectors.siteWidth?.addEventListener('input', sanitizeDimensionInput);
  selectors.siteHeight?.addEventListener('input', sanitizeDimensionInput);
  selectors.siteWidth?.addEventListener('blur', enforceDimensionBounds);
  selectors.siteHeight?.addEventListener('blur', enforceDimensionBounds);

  selectors.publishButton?.addEventListener('click', openPublishModal);
  selectors.publishModal
    ?.querySelectorAll('[data-action="closePublishModal"]').forEach((button) =>
      button.addEventListener('click', closePublishModal)
    );
  selectors.confirmPublish?.addEventListener('click', handlePublishConfirm);
  selectors.copyShareUrl?.addEventListener('click', copyShareUrlToClipboard);
  selectors.regenerateShareLink?.addEventListener('click', regenerateShareLink);
  selectors.publishConfirmModal
    ?.querySelector('[data-action="closePublishConfirm"]')
    ?.addEventListener('click', closePublishConfirmModal);
  selectors.finalizePublish?.addEventListener('click', finalizePublishPlan);
}

function handleClearLayout() {
  const current = ensureEvent();
  if (!current) return;

  const count = current.layout.elements.length;
  if (!count) {
    toast('Canvas already empty');
    return;
  }

  current.layout.elements = [];
  state.selectedSeatId = null;
  state.selectedSeatIds = [];
  state.multiSelect.active = false;
  state.viewport.bounds = null;
  persist();
  render();
  toast(`Cleared ${count} element${count === 1 ? '' : 's'}`);
}

function bindEditToolbar() {
  if (!selectors.editToolbar) return;

  selectors.rotateButton?.addEventListener('click', () => {
    const angle = Number(selectors.rotationInput?.value ?? 0) || 0;
    handleEditAction(EDIT_ACTIONS.ROTATE, angle % 360);
  });

  selectors.rotationInput?.addEventListener('change', (event) => {
    const angle = Number(event.target.value) || 0;
    handleEditAction(EDIT_ACTIONS.ROTATE, angle % 360);
  });

  selectors.handleButton?.addEventListener('click', () =>
    handleEditAction(EDIT_ACTIONS.TOGGLE_HANDLE)
  );
  selectors.copyButton?.addEventListener('click', () =>
    handleEditAction(EDIT_ACTIONS.COPY)
  );
  selectors.pasteButton?.addEventListener('click', () =>
    handleEditAction(EDIT_ACTIONS.PASTE)
  );
  selectors.duplicateButton?.addEventListener('click', () =>
    handleEditAction(EDIT_ACTIONS.DUPLICATE)
  );
  selectors.deleteButton?.addEventListener('click', () =>
    handleEditAction(EDIT_ACTIONS.DELETE)
  );
  selectors.bringFrontButton?.addEventListener('click', () =>
    handleEditAction(EDIT_ACTIONS.BRING_FRONT)
  );
  selectors.sendBackButton?.addEventListener('click', () =>
    handleEditAction(EDIT_ACTIONS.SEND_BACK)
  );
}

function bindContextMenu() {
  if (!selectors.contextMenu) return;

  selectors.contextMenu.addEventListener('click', (event) => {
    const menuNode = event.currentTarget;
    if (menuNode.dataset.mode === 'event') {
      return;
    }

    const target = event.target.closest('[data-menu-action]');
    if (!target) return;
    const action = target.dataset.menuAction;
    const angle = Number(selectors.rotationInput?.value ?? 0) || 0;

    if (action === 'delete-plan') {
      const eventId = selectors.contextMenu.dataset.eventId;
      if (eventId) deleteEvent(eventId);
      hideContextMenu();
      selectors.contextMenu.innerHTML = selectors.contextMenu.originalContent;
      return;
    }

    handleEditAction(action, angle % 360);
    hideContextMenu();
  });

  document.addEventListener('mousedown', (event) => {
    if (!state.contextMenu.visible) return;
    if (selectors.contextMenu?.contains(event.target)) return;
    hideContextMenu();
  });
}

function bindKeyboardShortcuts() {
  window.addEventListener('keydown', handleKeydownShortcut);
  window.addEventListener('keyup', handleKeyupShortcut);
}

function handleKeydownShortcut(event) {
  if (!event || typeof event.key !== 'string') return;
  if (isInput(event.target) && !event.metaKey && !event.ctrlKey) {
    return;
  }

  if (event.key === 'Meta') shortcutState.meta = true;
  if (event.key === 'Control') shortcutState.ctrl = true;
  if (event.key === 'Shift') shortcutState.shift = true;

  const isModifier = shortcutState.meta || shortcutState.ctrl;
  const selected = getSelectedElement();
  const hasMultiSelection = state.selectedSeatIds.length > 0;
  const hasAnySelection = Boolean(selected) || hasMultiSelection;

  const key = event.key.toLowerCase();

  switch (key) {
    case 'c':
      if (isModifier && selected) {
        event.preventDefault();
        handleEditAction(EDIT_ACTIONS.COPY);
      }
      break;
    case 'v':
      if (isModifier && state.clipboard) {
        event.preventDefault();
        handleEditAction(EDIT_ACTIONS.PASTE);
      }
      break;
    case 'd':
      if (isModifier && selected) {
        event.preventDefault();
        handleEditAction(EDIT_ACTIONS.DUPLICATE);
      }
      break;
    case 'delete':
    case 'backspace':
      if (!isInput(event.target) && hasAnySelection) {
        event.preventDefault();
        handleEditAction(EDIT_ACTIONS.DELETE);
      }
      break;
    case 'r':
      if (isModifier && selected) {
        event.preventDefault();
        handleEditAction(EDIT_ACTIONS.TOGGLE_HANDLE);
      }
      break;
    case ']':
      if (shortcutState.shift && selected) {
        event.preventDefault();
        handleEditAction(EDIT_ACTIONS.BRING_FRONT);
      }
      break;
    case '[':
      if (shortcutState.shift && selected) {
        event.preventDefault();
        handleEditAction(EDIT_ACTIONS.SEND_BACK);
      }
      break;
    case 'arrowright':
    case 'arrowleft':
    case 'arrowup':
    case 'arrowdown':
      if (!isModifier && isInput(event.target)) {
        return;
      }
      break;
    default:
      break;
  }
}

function handleKeyupShortcut(event) {
  if (event.key === 'Meta') shortcutState.meta = false;
  if (event.key === 'Control') shortcutState.ctrl = false;
  if (event.key === 'Shift') shortcutState.shift = false;
}

function handleEditAction(action, payload) {
  const selectedElements = getSelectedElements();
  const primary = selectedElements[0] ?? null;
  switch (action) {
    case EDIT_ACTIONS.ROTATE:
      if (primary) applyRotationToElement(primary, payload ?? 0);
      break;
    case EDIT_ACTIONS.TOGGLE_HANDLE:
      if (primary) toggleRotationHandle();
      break;
    case EDIT_ACTIONS.COPY:
      if (primary) copyElement(primary);
      break;
    case EDIT_ACTIONS.PASTE:
      pasteElement();
      break;
    case EDIT_ACTIONS.DUPLICATE:
      if (primary) duplicateElement(primary.id);
      break;
    case EDIT_ACTIONS.DELETE:
      if (selectedElements.length === 1) {
        deleteElement(primary.id);
      } else if (selectedElements.length > 1) {
        deleteElements(selectedElements.map((element) => element.id));
      }
      break;
    case EDIT_ACTIONS.BRING_FRONT:
      if (primary) reorderElement(primary.id, { direction: 'front' });
      break;
    case EDIT_ACTIONS.SEND_BACK:
      if (primary) reorderElement(primary.id, { direction: 'back' });
      break;
    default:
      break;
  }
}

function applyRotationToElement(element, angle) {
  const current = getCurrentEvent();
  if (!current) return;

  element.rotation = Math.round(angle) % 360;
  persist();
  renderCanvas();
  syncEditToolbar(element);
}

function getElementBounds(element) {
  return {
    width: element.dimensions.width,
    height: element.dimensions.height,
  };
}

function copyElement(element) {
  state.clipboard = structuredClone(element);
  syncEditToolbar(element);
  toast(`${element.label} copied`, { tone: 'info' });
}

function pasteElement() {
  const template = state.clipboard;
  if (!template) return;
  const current = ensureEvent();
  if (!current) return;

  const clone = {
    ...structuredClone(template),
    id: crypto.randomUUID(),
    label: `${template.label} copy`,
    position: {
      x: template.position.x + CLONE_OFFSETS.paste.x,
      y: template.position.y + CLONE_OFFSETS.paste.y,
    },
  };

  if (RESET_TO_OPEN_TYPES.has(clone.type)) {
    clone.status = 'open';
    clone.guests = [];
  }

  clampElementToCanvas(clone);

  current.layout.elements.push(clone);
  persist();
  render();
  selectSeat(clone.id);
}

function reorderElement(elementId, { direction }) {
  const current = getCurrentEvent();
  if (!current) return;

  const elements = current.layout.elements;
  const index = elements.findIndex((el) => el.id === elementId);
  if (index === -1) return;

  const [item] = elements.splice(index, 1);
  if (direction === 'front') {
    elements.push(item);
  } else if (direction === 'back') {
    elements.unshift(item);
  }

  persist();
  render();
  selectSeat(item.id);
}

function isInput(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.getAttribute?.('contenteditable') === 'true'
  );
}

function getSelectedElement() {
  const current = getCurrentEvent();
  if (!current || !state.selectedSeatId) return null;
  return current.layout.elements.find((el) => el.id === state.selectedSeatId) ?? null;
}

function getActiveSelectionIds() {
  if (state.selectedSeatIds.length) return [...state.selectedSeatIds];
  if (state.selectedSeatId) return [state.selectedSeatId];
  return [];
}

function enableMultiSelect() {
  if (state.multiSelect.active) return;
  state.multiSelect.active = true;
  state.multiSelect.translate = null;
  state.multiSelect.dragState = null;
  state.multiSelect.previousSelection = getActiveSelectionIds();
  state.selectedSeatIds = [...new Set(state.multiSelect.previousSelection)];
  state.selectedSeatId = null;
  applySelectionClasses();
  renderSeatDetails();
  syncEditToolbar();
}

function disableMultiSelect(options = {}) {
  const { preserveSelection = false } = options;
  if (!preserveSelection) {
    state.selectedSeatIds = [];
  }
  state.multiSelect.active = false;
  state.multiSelect.anchor = null;
  state.multiSelect.current = null;
  state.multiSelect.previousSelection = [];
  state.multiSelect.hasDragged = false;
  state.multiSelect.dragging = false;
  state.multiSelect.pointerId = null;
  state.multiSelect.translate = null;
  state.multiSelect.dragState = null;
  state.selectionPreview = [];
  selectors.selectionOverlay?.remove();
  selectors.selectionOverlay = null;
}

function ensureSelectionOverlay() {
  if (selectors.selectionOverlay || !selectors.layer) return selectors.selectionOverlay;
  const node = document.createElement('div');
  node.className = 'selection-rect';
  selectors.layer.appendChild(node);
  selectors.selectionOverlay = node;
  return node;
}

function applySelectionClasses() {
  if (!selectors.canvas) return;
  const previewIds = new Set(state.selectionPreview ?? []);
  const multiIds = new Set(state.selectedSeatIds ?? []);
  const singleId = state.selectedSeatId;

  selectors.canvas.querySelectorAll('.canvas-element').forEach((node) => {
    const id = node.dataset.id;
    const isMultiSelected = multiIds.has(id);
    const isPrimarySelection =
      (singleId && !multiIds.size && id === singleId) || isMultiSelected;
    node.classList.toggle('selected', isPrimarySelection);
    node.classList.toggle('multi-selected', isMultiSelected);
    node.classList.toggle('preview-selected', previewIds.has(id) && !isMultiSelected);
  });
}

function updateSelectionPreview(ids) {
  state.selectionPreview = ids;
  applySelectionClasses();
}

function toggleMultiSelection(id, { ensure = false } = {}) {
  if (!state.multiSelect.active) {
    enableMultiSelect();
  }

  const existingIndex = state.selectedSeatIds.indexOf(id);
  if (existingIndex === -1) {
    state.selectedSeatIds.push(id);
  } else if (!ensure) {
    state.selectedSeatIds.splice(existingIndex, 1);
  }

  if (state.selectedSeatIds.length <= 1) {
    const [single] = state.selectedSeatIds;
    disableMultiSelect({ preserveSelection: false });
    if (single) {
      state.selectedSeatId = single;
    } else {
      state.selectedSeatId = null;
    }
  } else {
    state.selectedSeatId = null;
  }

  applySelectionClasses();
  renderSeatDetails();
  const primary = getSelectedElement();
  syncEditToolbar(primary);
}

function beginMultiSelection(point, event) {
  if (!state.multiSelect.active) {
    state.multiSelect.active = true;
    state.selectedSeatId = null;
    state.selectedSeatIds = [];
    state.multiSelect.previousSelection = [];
    state.multiSelect.translate = null;
    state.multiSelect.dragState = null;
    applySelectionClasses();
    renderSeatDetails();
    syncEditToolbar();
  }
  ensureSelectionOverlay();
  state.multiSelect.anchor = { ...point };
  state.multiSelect.current = { ...point };
  state.multiSelect.hasDragged = false;
  state.multiSelect.dragging = true;
  state.multiSelect.pointerId = event.pointerId ?? null;
  state.selectionPreview = [];
  if (event.pointerId !== undefined && selectors.canvas?.setPointerCapture) {
    selectors.canvas.setPointerCapture(event.pointerId);
  }
  updateSelectionOverlay();
}

function updateSelectionOverlay() {
  const overlay = selectors.selectionOverlay || ensureSelectionOverlay();
  if (!overlay || !state.multiSelect.anchor || !state.multiSelect.current) return;

  const { x: ax, y: ay } = state.multiSelect.anchor;
  const { x: cx, y: cy } = state.multiSelect.current;
  const left = Math.min(ax, cx);
  const top = Math.min(ay, cy);
  const width = Math.abs(ax - cx);
  const height = Math.abs(ay - cy);

  overlay.style.display = 'block';
  overlay.style.left = `${left}px`;
  overlay.style.top = `${top}px`;
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
}

function updateMultiSelection(event) {
  if (!state.multiSelect.active || !state.multiSelect.dragging) return;
  const point = screenToStagePoint(event.clientX, event.clientY);
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

  state.multiSelect.current = point;
  const width = Math.abs(state.multiSelect.anchor.x - point.x);
  const height = Math.abs(state.multiSelect.anchor.y - point.y);
  if (width > 2 || height > 2) {
    state.multiSelect.hasDragged = true;
  }

  updateSelectionOverlay();

  const ids = collectElementsWithinRect(state.multiSelect.anchor, point);
  updateSelectionPreview(ids);
}

function finalizeMultiSelection() {
  if (!state.multiSelect.active) return;

  if (state.multiSelect.pointerId !== null && selectors.canvas?.releasePointerCapture) {
    try {
      selectors.canvas.releasePointerCapture(state.multiSelect.pointerId);
    } catch (error) {
      // ignore release errors (pointer might already be released)
    }
  }

  const hadDrag = state.multiSelect.hasDragged;
  const preview = [...state.selectionPreview];

  state.multiSelect.anchor = null;
  state.multiSelect.current = null;
  state.multiSelect.dragging = false;
  state.multiSelect.pointerId = null;
  state.multiSelect.hasDragged = false;
  state.multiSelect.translate = null;
  state.multiSelect.dragState = null;
  selectors.selectionOverlay?.remove();
  selectors.selectionOverlay = null;
  state.selectionPreview = [];
  state.suppressCanvasClear = true;

  if (hadDrag) {
    state.selectedSeatIds = [...new Set(preview)];
    if (state.selectedSeatIds.length <= 1) {
      const [single] = state.selectedSeatIds;
      disableMultiSelect();
      state.selectedSeatId = single ?? null;
      applySelectionClasses();
      renderSeatDetails();
      const singleElement = single ? getSelectedElement() : null;
      syncEditToolbar(singleElement ?? undefined);
      return;
    }
    state.selectedSeatId = null;
    applySelectionClasses();
    renderSeatDetails();
    syncEditToolbar();
  } else {
    applySelectionClasses();
  }
}

function collectElementsWithinRect(anchor, point) {
  const current = getCurrentEvent();
  if (!current) return [];
  const minX = Math.min(anchor.x, point.x);
  const minY = Math.min(anchor.y, point.y);
  const maxX = Math.max(anchor.x, point.x);
  const maxY = Math.max(anchor.y, point.y);

  return current.layout.elements
    .filter((element) => {
      const left = element.position.x;
      const top = element.position.y;
      const right = left + element.dimensions.width;
      const bottom = top + element.dimensions.height;
      return right >= minX && left <= maxX && bottom >= minY && top <= maxY;
    })
    .map((element) => element.id);
}

function getSelectedElements() {
  const current = getCurrentEvent();
  if (!current) return [];
  if (state.selectedSeatIds.length) {
    return current.layout.elements.filter((el) => state.selectedSeatIds.includes(el.id));
  }
  if (state.selectedSeatId) {
    const single = current.layout.elements.find((el) => el.id === state.selectedSeatId);
    return single ? [single] : [];
  }
  return [];
}

function showContextMenu(clientX, clientY) {
  if (!selectors.contextMenu) return;
  const menu = selectors.contextMenu;
  menu.style.left = `${clientX + 6}px`;
  menu.style.top = `${clientY + 6}px`;
  menu.setAttribute('aria-hidden', 'false');
  state.contextMenu.visible = true;
  state.contextMenu.position = { x: clientX, y: clientY };
}

function hideContextMenu() {
  if (!selectors.contextMenu) return;
  selectors.contextMenu.setAttribute('aria-hidden', 'true');
  selectors.contextMenu.removeAttribute('data-event-id');
  delete selectors.contextMenu.dataset.mode;
  selectors.contextMenu.innerHTML = selectors.contextMenu.originalContent ?? selectors.contextMenu.innerHTML;
  state.contextMenu.visible = false;
}

function toggleRotationHandle(force) {
  const selected = getSelectedElement();
  if (!selected) {
    hideRotationHandle();
    return;
  }

  const shouldShow =
    typeof force === 'boolean' ? force : !state.rotationHandle.active;
  state.rotationHandle.active = shouldShow;
  state.rotationHandle.elementId = shouldShow ? selected.id : null;
  state.rotationHandle.dragging = false;
  updateRotationHandle();

  if (selectors.handleButton) {
    selectors.handleButton.setAttribute('aria-pressed', shouldShow ? 'true' : 'false');
  }
}

function hideRotationHandle() {
  state.rotationHandle.active = false;
  state.rotationHandle.elementId = null;
  state.rotationHandle.dragging = false;
  rotationOverlay.container?.style?.setProperty('display', 'none');
  if (selectors.handleButton) {
    selectors.handleButton.setAttribute('aria-pressed', 'false');
  }
}

function ensureRotationOverlay() {
  if (rotationOverlay.container || !selectors.canvas) return;

  const container = document.createElement('div');
  container.className = 'rotation-gizmo';
  container.style.position = 'absolute';
  container.style.pointerEvents = 'none';
  container.style.display = 'none';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 220 220');

  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('cx', '110');
  circle.setAttribute('cy', '110');
  circle.setAttribute('r', '100');
  circle.setAttribute('class', 'rotation-gizmo__circle');

  const line = document.createElementNS(svgNS, 'line');
  line.setAttribute('x1', '110');
  line.setAttribute('y1', '110');
  line.setAttribute('x2', '210');
  line.setAttribute('y2', '110');
  line.setAttribute('class', 'rotation-gizmo__line');

  const handle = document.createElementNS(svgNS, 'circle');
  handle.setAttribute('r', '10');
  handle.setAttribute('cx', '210');
  handle.setAttribute('cy', '110');
  handle.setAttribute('class', 'rotation-gizmo__handle');
  handle.style.pointerEvents = 'auto';

  handle.addEventListener('pointerdown', handleRotationHandlePointerDown);

  const label = document.createElement('div');
  label.className = 'rotation-gizmo__angle-label';
  label.textContent = '0°';

  svg.appendChild(circle);
  svg.appendChild(line);
  svg.appendChild(handle);
  container.appendChild(svg);
  container.appendChild(label);
  selectors.canvas.appendChild(container);

  rotationOverlay.container = container;
  rotationOverlay.svg = svg;
  rotationOverlay.circle = circle;
  rotationOverlay.line = line;
  rotationOverlay.handle = handle;
  rotationOverlay.label = label;
}

function updateRotationHandle() {
  ensureRotationOverlay();
  if (!rotationOverlay.container || !selectors.layer) return;

  const selected = getSelectedElement();
  if (!state.rotationHandle.active || !selected) {
    rotationOverlay.container.style.display = 'none';
    return;
  }

  const node = selectors.layer.querySelector(
    `.canvas-element[data-id="${selected.id}"]`
  );
  if (!node) {
    rotationOverlay.container.style.display = 'none';
    return;
  }

  const rect = node.getBoundingClientRect();
  const layerRect = selectors.layer.getBoundingClientRect();

  const centerX = rect.left + rect.width / 2 - layerRect.left;
  const centerY = rect.top + rect.height / 2 - layerRect.top;
  const radius = Math.max(
    Math.max(rect.width, rect.height) / 2 + ROTATION_HANDLE_PADDING,
    ROTATION_HANDLE_MIN_RADIUS
  );

  rotationOverlay.container.style.display = 'block';
  rotationOverlay.container.style.left = `${centerX - radius}px`;
  rotationOverlay.container.style.top = `${centerY - radius}px`;
  rotationOverlay.container.style.width = `${radius * 2}px`;
  rotationOverlay.container.style.height = `${radius * 2}px`;

  const angle = selected.rotation || 0;
  const rad = ((angle - 90) * Math.PI) / 180;
  const handleX = radius + Math.cos(rad) * radius;
  const handleY = radius + Math.sin(rad) * radius;

  rotationOverlay.line?.setAttribute('x1', `${radius}`);
  rotationOverlay.line?.setAttribute('y1', `${radius}`);
  rotationOverlay.line?.setAttribute('x2', `${handleX}`);
  rotationOverlay.line?.setAttribute('y2', `${handleY}`);
  rotationOverlay.handle?.setAttribute('cx', `${handleX}`);
  rotationOverlay.handle?.setAttribute('cy', `${handleY}`);
  rotationOverlay.label.textContent = `${Math.round(angle)}°`;
}

function handleRotationHandlePointerDown(event) {
  event.preventDefault();
  const selected = getSelectedElement();
  if (!selected || !rotationOverlay.handle) return;

  state.rotationHandle.dragging = true;
  state.rotationHandle.elementId = selected.id;

  rotationOverlay.handle.setPointerCapture(event.pointerId);
  window.addEventListener('pointermove', handleRotationHandlePointerMove);
  window.addEventListener('pointerup', handleRotationHandlePointerUp, { once: true });
}

function handleRotationHandlePointerMove(event) {
  if (!state.rotationHandle.dragging) return;
  const selected = getSelectedElement();
  if (!selected || !selectors.layer) return;

  const layerRect = selectors.layer.getBoundingClientRect();
  const pointer = {
    x: (event.clientX - layerRect.left) / state.zoom,
    y: (event.clientY - layerRect.top) / state.zoom,
  };

  const center = getElementCenter(selected);
  const angle =
    Math.atan2(pointer.y - center.y, pointer.x - center.x) * (180 / Math.PI) + 90;
  applyRotationToElement(selected, angle);
}

function handleRotationHandlePointerUp(event) {
  rotationOverlay.handle?.releasePointerCapture(event.pointerId);
  state.rotationHandle.dragging = false;
  window.removeEventListener('pointermove', handleRotationHandlePointerMove);
  updateRotationHandle();
}

function getElementCenter(element) {
  return {
    x: element.position.x + element.dimensions.width / 2,
    y: element.position.y + element.dimensions.height / 2,
  };
}

function getStorageKeyForUser(userId) {
  return userId ? `${storageKeyBase}-${userId}` : storageKeyBase;
}

function getLayoutStorageKeyForUser(userId) {
  return userId ? `${layoutStorageKeyBase}-${userId}` : layoutStorageKeyBase;
}

function hydrate() {
  const userId = state.auth.user?.id ?? null;
  if (!userId) {
    applyPanelLayout(panelState);
    return;
  }

  try {
    const key = getStorageKeyForUser(userId);
    const cached = localStorage.getItem(key);
    if (!cached) return;
    const parsed = JSON.parse(cached);
    Object.assign(state, parsed, {
      auth: {
        user: state.auth.user,
      },
      viewport: {
        pan: parsed.viewport?.pan ?? { ...state.viewport.pan },
        size: parsed.viewport?.size ?? { ...state.viewport.size },
        offset: parsed.viewport?.offset ?? { ...state.viewport.offset },
        initialized: false,
        bounds: parsed.viewport?.bounds ?? null,
      },
      rotationHandle: {
        ...state.rotationHandle,
        ...parsed.rotationHandle,
      },
      multiSelect: {
        ...createInitialMultiSelectState(),
        ...parsed.multiSelect,
        translate: null,
        dragState: null,
      },
    });
  } catch (error) {
    console.error('Failed to load state', error);
  }

  try {
    const layoutKey = getLayoutStorageKeyForUser(userId);
    const layoutState = JSON.parse(localStorage.getItem(layoutKey) ?? '{}');
    applyPanelLayout(layoutState);
  } catch (error) {
    console.error('Failed to load panel layout state', error);
  }

  initializePanelState();
}

function persist(options = {}) {
  const { skipRemoteSchedule = false } = options;
  const userId = state.auth.user?.id ?? null;
  if (!userId) {
    persistLayoutState();
    return;
  }

  try {
    const key = getStorageKeyForUser(userId);
    const dataToPersist = {
      events: state.events,
      selectedEventId: state.selectedEventId,
      selectedSeatId: state.selectedSeatId,
      selectedSeatIds: state.selectedSeatIds,
      selectionPreview: state.selectionPreview,
      multiSelect: state.multiSelect,
      currentTool: state.currentTool,
      currentIntent: state.currentIntent,
      zoom: state.zoom,
      viewport: state.viewport,
      dragState: state.dragState,
      lastCanvasPoint: state.lastCanvasPoint,
      clipboard: state.clipboard,
      rotationHandle: state.rotationHandle,
      contextMenu: state.contextMenu,
      form: state.form,
    };
    localStorage.setItem(key, JSON.stringify(dataToPersist));
  } catch (error) {
    console.error('Failed to persist state', error);
  }

  const currentEventId = state.selectedEventId;
  if (!skipRemoteSchedule && currentEventId && supabase) {
    schedulePlanSync(currentEventId);
  }

  persistLayoutState();
}

function handleSessionHydration(session) {
  const previousUserId = state.auth.user?.id ?? null;
  if (!session) {
    state.auth.user = null;
    if (previousUserId) {
      clearUserScopedState();
      hydrate();
      render();
    }
    renderAuthState();
    return;
  }

  const user = authClient.mapUser(session);
  if (user) {
    state.auth.user = user;
    if (user.id !== previousUserId) {
      clearUserScopedState();
      hydrate();
      render();
    }
    persist();
    renderAuthState();
  }
}

function render() {
  renderEvents();
  renderCurrentEvent();
  renderGuests();
  renderSeatDetails();
  renderSyncStatus();
  renderCanvas();
  renderAssignments();
  renderAuthState();
  renderPanelToggles();
}

function renderEvents() {
  selectors.eventList.innerHTML = '';

  removePlanContextMenu();

  if (!state.events.length) {
    selectors.eventList.innerHTML = `
      <div class="empty-list">
        <h3>No events yet</h3>
        <p>Start by creating your first event plan.</p>
      </div>
    `;
    return;
  }

  state.events.forEach((event) => {
    const card = document.createElement('article');
    card.className = 'event-card';
    card.dataset.id = event.id;
    card.innerHTML = `
      <div>
        <h2>${event.name}</h2>
        <p class="muted">${formatDate(event.date)}</p>
      </div>
      <div class="event-meta">
        <span class="badge">${event.guests.length} guests</span>
        <span class="badge">${event.layout.elements.length} elements</span>
      </div>
    `;
    card.addEventListener('click', () => selectEvent(event.id));
    card.addEventListener('contextmenu', (eventObj) => handleEventCardContextMenu(eventObj, event.id));
    selectors.eventList.appendChild(card);
  });
}

function renderCurrentEvent() {
  const current = getCurrentEvent();
  selectors.currentEventName.textContent = current
    ? current.name
    : 'No event selected';

  if (!current) {
    return;
  }

  if (selectors.eventDateNative) {
    selectors.eventDateNative.value = current.date ?? '';
    updateDateDisplay();
  }

  selectors.eventCapacity.value = String(
    current.capacity ?? selectors.eventCapacity.dataset.default ?? '120'
  );
  selectors.eventVenue.value = current.venue ?? '';
}

function renderGuests() {
  const current = getCurrentEvent();
  selectors.guestList.innerHTML = '';

  if (!current) {
    selectors.guestList.innerHTML =
      '<p class="muted">Select or create an event to manage guests.</p>';
    return;
  }

  if (!current.guests.length) {
    selectors.guestList.innerHTML =
      '<p class="muted">Import guests or add them manually.</p>';
    return;
  }

  current.guests.forEach((guest) => {
    const card = document.createElement('div');
    card.className = 'guest-card';
    card.dataset.id = guest.id;
    card.innerHTML = `
      <span>${guest.name}</span>
      <span class="badge">${guest.tags.join(', ') || 'General'}</span>
    `;
    card.addEventListener('click', () => focusGuest(guest.id));
    selectors.guestList.appendChild(card);
  });
}

function renderSeatDetails() {
  const current = getCurrentEvent();
  selectors.seatDetails.innerHTML = '';
  if (!current) {
    selectors.seatDetails.innerHTML = '<p class="muted">Create an event to see element details.</p>';
    syncEditToolbar();
    ensureDetailsPanelCollapsed();
    return;
  }
  const selections = getSelectedElements();
  if (!selections.length) {
    selectors.seatDetails.innerHTML = '<p class="muted">Select an element on the canvas to edit its properties.</p>';
    selectors.deleteElement = null;
    selectors.duplicateElementBtn = null;
    syncEditToolbar();
    ensureDetailsPanelCollapsed();
    return;
  }

  if (selections.length > 1) {
    renderMultiSelectionInspector(selections);
    syncEditToolbar();
    ensureDetailsPanelExpanded();
    return;
  }

  const [seat] = selections;
  selectors.seatDetails.innerHTML = `
    <div class="element-inspector">
      <header>
        <div>
          <h3>${seat.label}</h3>
          <p class="muted">${capitalize(seat.type)}</p>
        </div>
        <span class="inspector-pill" data-status="${seat.status}">${capitalize(seat.status)}</span>
      </header>
      <div class="inspector-field">
        <span>Label</span>
        <input id="inspectorLabel" value="${seat.label}" />
      </div>
      <div class="inspector-field">
        <span>Seat price</span>
        <input id="inspectorPrice" type="number" min="0" value="${seat.price ?? ''}" placeholder="0" />
      </div>
      <div class="inspector-field">
        <span>Rotation</span>
        <input id="inspectorRotation" type="number" min="0" max="359" value="${seat.rotation || 0}" />
      </div>
      <div class="inspector-statuses">
        ${['open', 'reserved', 'blocked'].map((status) => `
          <button data-status="${status}" ${seat.status === status ? 'class="active"' : ''}>
            ${capitalize(status)}
          </button>
        `).join('')}
      </div>
      <div class="inspector-actions">
        <button class="ghost" data-action="duplicate">Duplicate</button>
        <button class="ghost" data-action="delete">Delete</button>
      </div>
    </div>
  `;
  selectors.seatDetails.querySelector('#inspectorLabel').addEventListener('input', (event) => {
    seat.label = event.target.value;
    persist();
    renderCanvas();
  });
  selectors.seatDetails.querySelector('#inspectorPrice').addEventListener('change', (event) => {
    const price = Number(event.target.value);
    if (Number.isNaN(price)) {
      seat.price = null;
    } else {
      seat.price = Math.max(0, price);
    }
    persist();
    renderCanvas();
  });
  selectors.seatDetails.querySelector('#inspectorRotation').addEventListener('change', (event) => {
    seat.rotation = Number(event.target.value) % 360;
    persist();
    renderCanvas();
  });
  selectors.seatDetails.querySelectorAll('.inspector-statuses button').forEach((button) => {
    button.addEventListener('click', () => {
      seat.status = button.dataset.status;
      persist();
      render();
    });
  });
  selectors.deleteElement = selectors.seatDetails.querySelector('[data-action="delete"]');
  selectors.duplicateElementBtn = selectors.seatDetails.querySelector('[data-action="duplicate"]');
  selectors.duplicateElementBtn.addEventListener('click', () => duplicateElement(seat.id));
  selectors.deleteElement.addEventListener('click', () => deleteElement(seat.id));

  syncEditToolbar(seat);
  ensureDetailsPanelExpanded();
}

function renderMultiSelectionInspector(selections) {
  if (!selectors.seatDetails) return;
  selectors.seatDetails.innerHTML = `
    <div class="element-inspector element-inspector--group">
      <header>
        <div>
          <h3>Group selection</h3>
          <p class="muted">${selections.length} elements selected</p>
        </div>
        <span class="inspector-pill">Multi edit</span>
      </header>
      <div class="group-panel">
        <div class="group-field">
          <label>Rename label</label>
          <input id="groupLabelInput" type="text" placeholder="Keep individual" />
        </div>
        <div class="group-field">
          <label>Rotation</label>
          <input id="groupRotationInput" type="number" min="0" max="359" placeholder="Mixed" />
        </div>
        <div class="group-field">
          <label>Seat price</label>
          <input id="groupPriceInput" type="number" min="0" placeholder="Mixed" />
        </div>
        <div class="group-list" data-group-list></div>
      </div>
    </div>
  `;

  const list = selectors.seatDetails.querySelector('[data-group-list]');
  if (!list) return;

  const nameInput = selectors.seatDetails.querySelector('#groupLabelInput');
  const rotationInput = selectors.seatDetails.querySelector('#groupRotationInput');
  const priceInput = selectors.seatDetails.querySelector('#groupPriceInput');

  const allSameRotation = selections.every((el) => el.rotation === selections[0].rotation);
  if (allSameRotation) {
    rotationInput.value = selections[0].rotation || 0;
  }

  const allSameLabel = selections.every((el) => el.label === selections[0].label);
  if (allSameLabel) {
    nameInput.value = selections[0].label;
  }

  nameInput.addEventListener('change', (event) => {
    const value = event.target.value.trim();
    if (!value) return;
    const current = getCurrentEvent();
    if (!current) return;
    selections.forEach((element, index) => {
      const name = index === 0 ? value : `${value} ${index + 1}`;
      element.label = name;
    });
    persist();
    render();
  });

  rotationInput.addEventListener('change', (event) => {
    const angle = Number(event.target.value) % 360;
    const current = getCurrentEvent();
    if (!current || Number.isNaN(angle)) return;
    selections.forEach((element) => {
      element.rotation = angle;
    });
    persist();
    renderCanvas();
  });

  priceInput.addEventListener('change', (event) => {
    const price = Number(event.target.value);
    if (Number.isNaN(price)) return;
    const current = getCurrentEvent();
    if (!current) return;
    selections.forEach((element) => {
      element.price = Math.max(0, price);
    });
    persist();
    renderCanvas();
  });

  selections.forEach((element) => {
    const row = document.createElement('div');
    row.className = 'group-item';
    row.dataset.id = element.id;
    row.innerHTML = `
      <div class="group-item__meta">
        <strong>${element.label}</strong>
        <span class="muted">${capitalize(element.type)}</span>
      </div>
      <div class="group-item__actions">
        <button type="button" data-action="focus" class="text-button">Focus</button>
        <button type="button" data-action="remove" class="text-button">Remove</button>
      </div>
    `;

    row.querySelector('[data-action="focus"]').addEventListener('click', () => {
      disableMultiSelect();
      selectSeat(element.id);
    });

    row.querySelector('[data-action="remove"]').addEventListener('click', () => {
      toggleMultiSelection(element.id);
    });

    list.appendChild(row);
  });

  const footer = document.createElement('footer');
  footer.className = 'group-actions';
  footer.innerHTML = `
    <button class="ghost" data-action="clear">Clear selection</button>
    <button class="ghost" data-action="delete">Delete selected</button>
  `;
  footer.querySelector('[data-action="clear"]').addEventListener('click', () => {
    clearSeatSelection();
  });
  footer.querySelector('[data-action="delete"]').addEventListener('click', () => {
    deleteElements(selections.map((element) => element.id));
  });
  selectors.seatDetails.appendChild(footer);
}

function renderSyncStatus() {
  selectors.syncStatus.querySelector('span').textContent = state.syncing
    ? 'Syncing changes...'
    : state.liveMode
    ? 'Live syncing'
    : 'Offline draft';
  selectors.syncStatus.classList.toggle('is-syncing', state.syncing);
}

function renderAuthState() {
  const isAuthenticated = Boolean(state.auth.user);
  selectors.loginOverlay?.setAttribute(
    'aria-hidden',
    isAuthenticated ? 'true' : 'false'
  );
  document.body.classList.toggle('auth-locked', !isAuthenticated);
  selectors.logoutButton?.classList.toggle('is-visible', isAuthenticated);
  if (!isAuthenticated) {
    selectors.loginHint.textContent = authClient.isConfigured
      ? 'Use your Google account linked to FlowSeat.'
      : 'Google login is disabled until Supabase credentials are added.';
  }
  selectors.loginError.textContent = '';
}

function unlockOnFirstInteraction() {
  // No-op when not authenticated. Users must sign in.
}

function renderCanvas() {
  const current = getCurrentEvent();
  const { layer, emptyState } = selectors;
  if (!layer || !selectors.stage) return;

  ensureCanvasBoundary(current?.layout.dimensions ?? null);

  if (!current || !current.layout.elements.length) {
    updateStageBounds([], current?.layout.dimensions ?? null);
    autoAnchorCenter();
    applyViewportStyles();
    emptyState.style.display = 'grid';
    layer
      .querySelectorAll('.canvas-element')
      .forEach((el) => el.remove());
    hideRotationHandle();
    hideContextMenu();
    syncEditToolbar();
    updateCanvasBackdrop(current?.layout.dimensions ?? null);
    return;
  }

  updateStageBounds(current.layout.elements, current.layout.dimensions);
  applyViewportStyles();
  emptyState.style.display = 'none';

  updateCanvasBackdrop(current.layout.dimensions);

  const existing = new Map();
  layer.querySelectorAll('.canvas-element').forEach((el) => {
    existing.set(el.dataset.id, el);
  });

  const seen = new Set();

  current.layout.elements.forEach((element) => {
    let node = existing.get(element.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'canvas-element';
      node.dataset.id = element.id;
      node.setAttribute('tabindex', '0');
      node.addEventListener('click', (event) => {
        event.stopPropagation();
        selectSeat(element.id);
      });
      layer.appendChild(node);
    }

    decorateElementNode(node, element);

    seen.add(element.id);
  });

  existing.forEach((node, id) => {
    if (!seen.has(id)) node.remove();
  });

  const selectedElement = state.selectedSeatId
    ? current.layout.elements.find((el) => el.id === state.selectedSeatId) ?? null
    : null;

  syncEditToolbar(selectedElement);
  updateRotationHandle();
}

function ensureCanvasBoundary(dimensions) {
  const stage = selectors.stage;
  if (!stage) return;
  const target = normalizeSiteDimensions(dimensions ?? DEFAULT_SITE_PIXELS);
  stage.style.setProperty('--canvas-rect-width', `${target.width}px`);
  stage.style.setProperty('--canvas-rect-height', `${target.height}px`);
}

function updateCanvasBackdrop(dimensions) {
  const stage = selectors.stage;
  if (!stage) return;

  const target = normalizeSiteDimensions(dimensions ?? DEFAULT_SITE_PIXELS);
  stage.style.setProperty('--canvas-rect-width', `${target.width}px`);
  stage.style.setProperty('--canvas-rect-height', `${target.height}px`);

  const viewportSize = state.viewport.size ?? { width: target.width, height: target.height };
  const viewportOffset = state.viewport.offset ?? {
    x: STAGE_EXPAND_MARGIN,
    y: STAGE_EXPAND_MARGIN,
  };

  const offsetX = (viewportSize.width - target.width) / 2;
  const offsetY = (viewportSize.height - target.height) / 2;
  stage.style.setProperty('--canvas-offset-x', `${offsetX}px`);
  stage.style.setProperty('--canvas-offset-y', `${offsetY}px`);
}

function autoAnchorCenter() {
  const canvasRect = selectors.canvas?.getBoundingClientRect();
  if (!canvasRect) return;

  const zoom = state.zoom || 1;
  const { size } = state.viewport;

  const panX = (canvasRect.width / zoom - size.width) / 2;
  const panY = (canvasRect.height / zoom - size.height) / 2;

  if (Number.isFinite(panX)) {
    state.viewport.pan.x = panX;
  }
  if (Number.isFinite(panY)) {
    state.viewport.pan.y = panY;
  }
}

function decorateElementNode(node, element) {
  const isSingleSelected = element.id === state.selectedSeatId;
  const multiSelected = state.selectedSeatIds.includes(element.id);
  const previewSelected = state.selectionPreview.includes(element.id);

  node.classList.toggle('selected', isSingleSelected || multiSelected);
  node.classList.toggle('multi-selected', multiSelected);
  node.classList.toggle('preview-selected', previewSelected && !multiSelected);
  node.dataset.status = element.status ?? 'open';
  node.dataset.type = element.type;
  node.classList.toggle('seat-status-occupied', element.status === 'occupied');
  node.classList.toggle('seat-status-vip', element.tags?.includes('VIP'));
  node.style.transform = `translate(${element.position.x}px, ${element.position.y}px) rotate(${element.rotation || 0}deg)`;
  node.style.width = `${element.dimensions.width}px`;
  node.style.height = `${element.dimensions.height}px`;
  node.innerHTML = renderElementGlyph(element);
}

function renderElementGlyph(element) {
  const seatNumber =
    element.type === 'seat'
      ? element.label.replace(/[^0-9]/g, '') || element.label
      : '';

  if (element.type === 'seat') {
    return `
      <span class="seat-glyph">${seatNumber}</span>
      ${Number.isFinite(Number(element.price)) && element.price > 0 ? `<span class="seat-meta-inline">${formatPrice(element.price)}</span>` : ''}
    `;
  }

  if (element.type === 'table') {
    return `
      <span class="element-label element-label-table">${element.label}</span>
    `;
  }

  return `
    <span class="element-label">${element.label}</span>
    ${Number.isFinite(Number(element.price)) && element.price > 0 ? `<span class="element-price">${formatPrice(element.price)}</span>` : ''}
  `;
}

async function handleGoogleSignIn() {
  try {
    if (!authClient.isConfigured) {
      selectors.loginError.textContent =
        'Google login is unavailable. Ask your admin to add Supabase credentials.';
      return;
    }

    selectors.googleLogin?.classList.add('is-loading');
    selectors.loginHint.textContent = 'Redirecting to Google…';
    await authClient.signInWithGoogle();
  } catch (error) {
    console.error('Google sign-in failed', error);
    selectors.loginError.textContent = error.message ?? 'Could not sign in with Google.';
  } finally {
    selectors.googleLogin?.classList.remove('is-loading');
    selectors.loginHint.textContent = authClient.isConfigured
      ? 'Use your Google account linked to FlowSeat.'
      : 'Google login is disabled until Supabase credentials are added.';
  }
}

function handleLogout() {
  authClient
    .signOut()
    .catch((error) => {
      console.error('Sign-out failed', error);
      toast('Sign-out failed', { tone: 'error' });
    })
    .finally(() => {
      state.auth.user = null;
      persist();
      renderAuthState();
      toast('Signed out');
      clearUserScopedState();
      render();
    });
}

function validateCredentials(email, password) {
  if (!email || !password) {
    return { ok: false, message: 'Enter your email and password.' };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return { ok: false, message: 'Enter a valid email address.' };
  }

  if (password.length < 6) {
    return { ok: false, message: 'Password must be at least 6 characters.' };
  }

  return { ok: true, message: '' };
}


function renderAssignments() {
  const {
    assignmentsPanel,
    assignmentsEvent,
    assignmentsSummary,
    assignmentsProgress,
    assignmentsFeed,
    assignmentsUpdated,
    detailsPanel,
  } = selectors;

  if (!assignmentsPanel || state.currentIntent !== 'assignments') {
    return;
  }

  assignmentsPanel.setAttribute('aria-busy', 'true');

  const current = getCurrentEvent();

  if (!current) {
    assignmentsPanel.setAttribute('aria-busy', 'false');
    assignmentsEvent.innerHTML = '<p class="muted">Select an event to monitor assignments.</p>';
    assignmentsSummary.innerHTML = '';
    assignmentsProgress.innerHTML = '';
    assignmentsFeed.innerHTML = '<p class="muted">Recent activity will appear here once available.</p>';
    if (assignmentsUpdated) {
      assignmentsUpdated.textContent = '—';
    }
    resetAssignmentsMap();
    detailsPanel?.classList.remove('is-hidden');
    return;
  }

  assignmentsEvent.innerHTML = `
    <h3>${current.name}</h3>
    <p>${formatDate(current.date)} · ${current.venue || 'Venue TBC'}</p>
  `;

  const totals = calculateAssignmentStats(current);

  const {
    capacity,
    sold,
    open,
    vipCapacity,
    vipSold,
    reserved,
    occupied,
  } = totals;

  assignmentsSummary.innerHTML = `
    <div class="assignments-metrics">
      <div class="assignments-metric">
        <span>Total capacity</span>
        <strong>${capacity}</strong>
      </div>
      <div class="assignments-metric">
        <span>Tickets sold</span>
        <strong>${sold}</strong>
      </div>
      <div class="assignments-metric">
        <span>Remaining</span>
        <strong>${open}</strong>
      </div>
      <div class="assignments-metric">
        <span>VIP sold</span>
        <strong>${vipSold}/${vipCapacity}</strong>
      </div>
    </div>
  `;

  const progress = capacity ? Math.round((sold / capacity) * 100) : 0;
  const occupancy = capacity ? Math.round((occupied / capacity) * 100) : 0;
  const reservedPct = capacity ? Math.round((reserved / capacity) * 100) : 0;

  assignmentsProgress.innerHTML = `
    <div class="assignments-progress__bar">
      <div class="assignments-progress__fill" style="width: ${progress}%"></div>
    </div>
    <div class="assignments-progress__legend">
      <span>Sales velocity</span>
      <strong>${progress}% sold</strong>
    </div>
    <div class="assignments-progress__legend">
      <span>Occupied</span>
      <strong>${occupancy}% seated</strong>
    </div>
    <div class="assignments-progress__legend">
      <span>Reserved blocks</span>
      <strong>${reservedPct}% held</strong>
    </div>
  `;

  assignmentsFeed.innerHTML = buildAssignmentsFeed(current);
  if (assignmentsUpdated) {
    assignmentsUpdated.textContent = `Updated ${formatRelativeTime(new Date())}`;
  }
  assignmentsPanel.setAttribute('aria-busy', 'false');

  renderAssignmentsMap(current);
}

function buildAssignmentsFeed(plan) {
  const recent = [...(plan.audit ?? [])]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 8);

  if (!recent.length) {
    return '<div class="assignments-feed__empty">No activity yet. Ticket sales updates will appear here.</div>';
  }

  return recent
    .map((entry) => {
      const time = entry.time ? formatRelativeTime(entry.time) : 'Moments ago';
      return `
        <article class="assignments-feed__item">
          <time>${time}</time>
          <strong>${entry.message}</strong>
        </article>
      `;
    })
    .join('');
}

function calculateAssignmentStats(plan) {
  const totals = {
    capacity: 0,
    sold: 0,
    reserved: 0,
    occupied: 0,
    open: 0,
    vipCapacity: 0,
    vipSold: 0,
  };

  plan.layout.elements.forEach((element) => {
    const capacity = Number.isFinite(element.capacity) ? element.capacity : 0;
    const guests = Array.isArray(element.guests) ? element.guests.length : 0;
    totals.capacity += capacity;
    totals.sold += guests;
    if (element.status === 'reserved') {
      totals.reserved += capacity;
    }
    if (element.status === 'occupied') {
      totals.occupied += capacity;
    } else {
      totals.occupied += guests;
    }

    if (Array.isArray(element.tags) && element.tags.includes('vip')) {
      totals.vipCapacity += capacity;
      totals.vipSold += guests;
    }
  });

  totals.open = Math.max(totals.capacity - totals.sold, 0);
  return totals;
}


function setIntent(intent) {
  state.currentIntent = intent;
  selectors.chips.forEach((chip) =>
    chip.classList.toggle('active', chip.dataset.intent === intent)
  );
  updateWorkspaceIntent(intent);
  render();
}

function updateWorkspaceIntent(intent) {
  const { workspaceBody, assignmentsPanel, canvas, detailsPanel } = selectors;
  if (!workspaceBody) return;
  workspaceBody.setAttribute('data-intent', intent);
  const isAssignments = intent === 'assignments';
  assignmentsPanel?.setAttribute('aria-hidden', String(!isAssignments));
  canvas?.setAttribute('aria-hidden', String(isAssignments));
  if (detailsPanel) {
    detailsPanel.classList.toggle('is-hidden', isAssignments);
  }
}

function formatRelativeTime(value) {
  try {
    const date = value instanceof Date ? value : new Date(value);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

    if (Number.isNaN(seconds)) return 'Just now';
    if (seconds < 30) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const formatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    return formatter.format(date);
  } catch (error) {
    return 'Just now';
  }
}

function setTool(tool) {
  state.currentTool = tool;
  state.dragState = null;
  selectors.toolButtons.forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.tool === tool)
  );
}

function handleToolClick(tool) {
  if (tool === 'select') {
    setTool('select');
    return;
  }

  state.lastCanvasPoint = null;
  setTool(tool);
}

function buildSiteDimensions({ width, height, unit }) {
  const scale = SITE_UNIT_SCALES[unit] ?? SITE_UNIT_SCALES[DEFAULT_SITE_DIMENSIONS.unit];
  return {
    width: Math.max(width, 1) * scale,
    height: Math.max(height, 1) * scale,
    unit,
    meters: {
      width,
      height,
    },
  };
}

async function handleCreateEvent(event) {
  event.preventDefault();
  const name = selectors.eventName.value.trim();
  if (!name) return;

  const dateValue = resolveEventDateValue();
  if (!dateValue) {
    openDatePicker();
    toast('Choose a date and time');
    return;
  }

  const unit = selectors.siteUnit?.value || DEFAULT_SITE_DIMENSIONS.unit;
  const widthMeters = Number.parseFloat(selectors.siteWidth?.value ?? '') || DEFAULT_SITE_DIMENSIONS.width;
  const heightMeters = Number.parseFloat(selectors.siteHeight?.value ?? '') || DEFAULT_SITE_DIMENSIONS.height;

  const capacity = Number.parseInt(selectors.eventCapacity.value, 10);
  if (!Number.isInteger(capacity) || capacity <= 0) {
    selectors.eventCapacity.focus();
    toast('Capacity must be at least 1');
    return;
  }

  if (!Number.isFinite(widthMeters) || widthMeters <= 0) {
    selectors.siteWidth?.focus();
    toast('Enter a valid site width');
    return;
  }

  if (!Number.isFinite(heightMeters) || heightMeters <= 0) {
    selectors.siteHeight?.focus();
    toast('Enter a valid site height');
    return;
  }

  const siteDimensions = buildSiteDimensions({ width: widthMeters, height: heightMeters, unit });

  if (!ensureAuthenticated()) return;

  try {
    await createPlan({
      name,
      date: dateValue,
      venue: selectors.eventVenue.value,
      capacity,
      layout: {
        elements: [],
        dimensions: siteDimensions,
      },
    });
    selectors.eventForm.reset();
    restoreFormDefaults();
    toast('Event created');
  } catch (error) {
    console.error('Failed to create plan', error);
    toast(error.message ?? 'Could not create plan', { tone: 'error' });
  }
}

function restoreFormDefaults() {
  if (selectors.eventDateNative) selectors.eventDateNative.value = '';
  selectors.eventDateDisplay.textContent = 'Select date & time';
  selectors.openEventDatePicker?.classList.remove('has-value');
  selectors.eventCapacity.value = selectors.eventCapacity.dataset.default ?? '120';
  selectors.eventVenue.value = '';
  selectors.siteWidth && (selectors.siteWidth.value = String(DEFAULT_SITE_DIMENSIONS.width));
  selectors.siteHeight && (selectors.siteHeight.value = String(DEFAULT_SITE_DIMENSIONS.height));
  selectors.siteUnit && (selectors.siteUnit.value = DEFAULT_SITE_DIMENSIONS.unit);
}

function selectEvent(eventId) {
  state.selectedEventId = eventId;
  state.selectedSeatId = null;
  render();
}

function getCurrentEvent() {
  return state.events.find((event) => event.id === state.selectedEventId) ?? null;
}

function handleBalanceTables() {
  const current = ensureEvent();
  if (!current) return;

  const seats = current.layout.elements.filter((el) => el.capacity > 1);
  seats.sort((a, b) => b.guests.length - a.guests.length);

  let moved = 0;
  let iterations = 0;

  while (iterations < 50) {
    const fullest = seats[0];
    const emptiest = seats[seats.length - 1];
    if (!fullest || !emptiest) break;
    if (fullest.guests.length - emptiest.guests.length <= 1) break;

    const guestId = fullest.guests.pop();
    emptiest.guests.push(guestId);
    const guest = current.guests.find((g) => g.id === guestId);
    if (guest) guest.seatId = emptiest.id;
    seats.sort((a, b) => b.guests.length - a.guests.length);
    moved += 1;
    iterations += 1;
  }

  if (moved) {
    current.audit.push(createAuditEntry(`Balanced tables: ${moved} moves`));
    persist();
    render();
    toast('Tables balanced');
  } else {
    toast('Already balanced');
  }
}

function handleCanvasClick(event) {
  if (state.multiSelect.dragging) {
    return;
  }

  if (state.suppressCanvasClear) {
    state.suppressCanvasClear = false;
    return;
  }

  if (state.multiSelect.active && state.multiSelect.hasDragged) {
    finalizeMultiSelection();
    return;
  }

  const elementNode = event.target.closest('.canvas-element');
  if (!elementNode) {
    clearSeatSelection();
    return;
  }

  const elementId = elementNode.dataset.id;
  if (!elementId) {
    clearSeatSelection();
    return;
  }

  if (state.multiSelect.active) {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      toggleMultiSelection(elementId);
    } else {
      disableMultiSelect();
      selectSeat(elementId);
    }
    return;
  }

  if (state.selectedSeatIds.length > 1) {
    state.selectedSeatIds = [];
  }

  if (state.selectedSeatId === elementId) {
    return;
  }

  selectSeat(elementId);
}

function handlePointerDown(event) {
  if (event.button !== 0) return;
  const current = ensureEvent();
  if (!current) return;
  const bounds = getVisibleCanvasBounds();
  const rawPoint = screenToStagePoint(event.clientX, event.clientY);
  const point = {
    x: clamp(rawPoint.x, bounds.minX, bounds.maxX),
    y: clamp(rawPoint.y, bounds.minY, bounds.maxY),
  };
  state.lastCanvasPoint = { ...point };
  const previousDown = state.multiSelect.lastPointerDown;
  state.multiSelect.lastPointerDown = event.timeStamp;
  const isDoublePointer = event.timeStamp - previousDown < 320;
  const targetElement = event.target.closest('.canvas-element');
  if (state.currentTool !== 'select' && state.currentTool !== 'rotate' && !targetElement) {
    createElementAt(point, state.currentTool);
    return;
  }
  if (!targetElement && isDoublePointer && event.isPrimary !== false) {
    state.multiSelect.active = true;
    state.selectedSeatId = null;
    state.selectedSeatIds = [];
    applySelectionClasses();
    renderSeatDetails();
    syncEditToolbar(null);
  }

  if (state.multiSelect.active && !targetElement && event.isPrimary !== false) {
    beginMultiSelection(point, event);
    state.suppressCanvasClear = true;
    return;
  }
  if (targetElement) {
    const id = targetElement.dataset.id;
    const element = current.layout.elements.find((el) => el.id === id);
    if (!element) return;
    if (state.multiSelect.active) {
      toggleMultiSelection(id, { ensure: true });
      if (state.multiSelect.active && state.selectedSeatIds.length > 1) {
        state.multiSelect.anchor = { ...point };
        state.multiSelect.current = { ...point };
        state.multiSelect.hasDragged = false;
        state.multiSelect.dragging = true;
        state.multiSelect.pointerId = event.pointerId ?? null;
        state.multiSelect.translate = { x: 0, y: 0 };
        state.multiSelect.dragState = {
          start: { ...point },
          origin: captureElementsOrigin(state.selectedSeatIds),
        };
        if (event.pointerId !== undefined && selectors.canvas?.setPointerCapture) {
          selectors.canvas.setPointerCapture(event.pointerId);
        }
        hideContextMenu();
        state.suppressCanvasClear = true;
        return;
      }
    }
    if (state.selectedSeatId !== id) {
      selectSeat(id);
    }
  state.dragState = {
    id,
    startX: point.x,
    startY: point.y,
    origin: { ...element.position },
    rotationStart: element.rotation || 0,
  };
    selectors.canvas.setPointerCapture(event.pointerId);
    state.suppressCanvasClear = true;
    hideContextMenu();
  }
}

function handlePointerMove(event) {
  trackCanvasPoint(event);
  if (state.multiSelect.dragState) {
    handleMultiDragMove(event);
    return;
  }
  if (state.multiSelect.active && state.multiSelect.anchor) {
    updateMultiSelection(event);
    return;
  }
  if (!state.dragState) return;
  const current = ensureEvent();
  if (!current) return;
  const element = current.layout.elements.find((el) => el.id === state.dragState.id);
  if (!element) return;

  const bounds = getVisibleCanvasBounds();
  const point = {
    x: clamp(screenToStagePoint(event.clientX, event.clientY).x, bounds.minX, bounds.maxX),
    y: clamp(screenToStagePoint(event.clientX, event.clientY).y, bounds.minY, bounds.maxY),
  };
  const node = selectors.canvas.querySelector(`[data-id="${element.id}"]`);
  if (!node) return;
  if (state.currentTool === 'rotate') {
    const center = {
      x: element.position.x + element.dimensions.width / 2,
      y: element.position.y + element.dimensions.height / 2,
    };
    const angle = Math.atan2(point.y - center.y, point.x - center.x);
    element.rotation = Math.round((angle * 180) / Math.PI + 360) % 360;
    decorateElementNode(node, element);
    updateRotationHandle();
    const selected = getSelectedElement();
    if (selected && selected.id === element.id) {
      syncEditToolbar(selected);
    }
    return;
  }
  const boundsForMovement = getVisibleCanvasBounds();
  const maxX = Math.max(boundsForMovement.minX, boundsForMovement.maxX - element.dimensions.width);
  const maxY = Math.max(boundsForMovement.minY, boundsForMovement.maxY - element.dimensions.height);
  const clampedPoint = {
    x: clamp(point.x, boundsForMovement.minX, maxX),
    y: clamp(point.y, boundsForMovement.minY, maxY),
  };

  const deltaX = clampedPoint.x - state.dragState.startX;
  const deltaY = clampedPoint.y - state.dragState.startY;
  const snap = event.shiftKey ? 1 : 10;
  element.position.x = Math.round((state.dragState.origin.x + deltaX) / snap) * snap;
  element.position.y = Math.round((state.dragState.origin.y + deltaY) / snap) * snap;
  clampElementToCanvas(element);
  decorateElementNode(node, element);
  if (state.rotationHandle.active && state.rotationHandle.elementId === element.id) {
    updateRotationHandle();
  }
}

function handlePointerUp(event) {
  if (state.multiSelect.dragState) {
    finalizeMultiDrag(event.pointerId);
    return;
  }
  if (state.multiSelect.active && state.multiSelect.dragging) {
    finalizeMultiSelection();
    if (state.multiSelect.pointerId !== null && selectors.canvas?.releasePointerCapture) {
      try {
        selectors.canvas.releasePointerCapture(state.multiSelect.pointerId);
      } catch (error) {
        // ignore
      }
    }
    return;
  }
  if (state.dragState) {
    selectors.canvas.releasePointerCapture(event.pointerId);
    state.dragState = null;
    persist();
    state.suppressCanvasClear = true;
    renderSeatDetails();
  }
}

function handleCanvasContextMenu(event) {
  event.preventDefault();
  hideContextMenu();

  if (selectors.contextMenu && selectors.contextMenu.innerHTML !== selectors.contextMenu.originalContent) {
    selectors.contextMenu.innerHTML = selectors.contextMenu.originalContent;
  }

  const elementNode = event.target.closest('.canvas-element');
  if (!elementNode) {
    syncEditToolbar();
    return;
  }

  const elementId = elementNode.dataset.id;
  if (elementId) {
    selectSeat(elementId);
    state.contextMenu.elementId = elementId;
    selectors.contextMenu.dataset.eventId = '';
  }

  showContextMenu(event.clientX, event.clientY);
}

function createElementAt(point, type) {
  const current = ensureEvent();
  if (!current) return;
  if (state.currentTool === 'select') {
    return;
  }
  const template = getElementTemplate(type);
  if (!template) return;
  const id = crypto.randomUUID();
  const bounds = getVisibleCanvasBounds();
  const maxX = Math.max(bounds.minX, bounds.maxX - template.dimensions.width);
  const maxY = Math.max(bounds.minY, bounds.maxY - template.dimensions.height);
  const centered = {
    x: point.x - template.dimensions.width / 2,
    y: point.y - template.dimensions.height / 2,
  };
  const element = {
    ...template,
    id,
    label: `${template.labelPrefix ?? template.type} ${current.layout.elements.filter((el) => el.type === template.type).length + 1}`,
    position: {
      x: clamp(centered.x, bounds.minX, maxX),
      y: clamp(centered.y, bounds.minY, maxY),
    },
  };
  clampElementToCanvas(element);
  current.layout.elements.push(element);
  state.selectedSeatId = id;
  current.audit.push(createAuditEntry(`${capitalize(template.type)} added`, { elementId: id }));
  persist();
  render();
}

function trackCanvasPoint(event) {
  const { x, y } = screenToStagePoint(event.clientX, event.clientY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const bounds = getVisibleCanvasBounds();
  state.lastCanvasPoint = {
    x: clamp(x, bounds.minX, bounds.maxX),
    y: clamp(y, bounds.minY, bounds.maxY),
  };
}

function screenToStagePoint(clientX, clientY) {
  const rect = selectors.layer.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / state.zoom,
    y: (clientY - rect.top) / state.zoom,
  };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function getLayoutBounds() {
  const current = getCurrentEvent();
  const dimensions = current?.layout?.dimensions ?? DEFAULT_SITE_PIXELS;
  const width = Number.isFinite(dimensions?.width) ? dimensions.width : DEFAULT_SITE_PIXELS.width;
  const height = Number.isFinite(dimensions?.height) ? dimensions.height : DEFAULT_SITE_PIXELS.height;
  return {
    minX: 0,
    minY: 0,
    maxX: Math.max(0, width),
    maxY: Math.max(0, height),
  };
}

function getVisibleCanvasBounds() {
  if (!selectors.canvas) {
    return getLayoutBounds();
  }

  const rect = selectors.canvas.getBoundingClientRect();
  const visibleWidth = rect.width / state.zoom;
  const visibleHeight = rect.height / state.zoom;
  const layoutBounds = getLayoutBounds();

  return {
    minX: layoutBounds.minX,
    minY: layoutBounds.minY,
    maxX: layoutBounds.maxX,
    maxY: layoutBounds.maxY,
  };
}

function clampElementToCanvas(element) {
  if (!element || !element.position || !element.dimensions) return;
  const bounds = getVisibleCanvasBounds();
  const width = Number.isFinite(element.dimensions.width) ? element.dimensions.width : 0;
  const height = Number.isFinite(element.dimensions.height) ? element.dimensions.height : 0;
  const maxX = Math.max(bounds.minX, bounds.maxX - width);
  const maxY = Math.max(bounds.minY, bounds.maxY - height);
  element.position.x = clamp(element.position.x, bounds.minX, maxX);
  element.position.y = clamp(element.position.y, bounds.minY, maxY);
}

function getElementTemplate(type) {
  const templates = {
    seat: {
      type: 'seat',
      labelPrefix: 'Seat',
      capacity: 1,
      guests: [],
      status: 'open',
      price: null,
      rotation: 0,
      dimensions: { width: 46, height: 46 },
      tags: [],
    },
    table: {
      type: 'table',
      labelPrefix: 'Table',
      capacity: 8,
      guests: [],
      status: 'open',
      price: null,
      rotation: 0,
      dimensions: { width: 120, height: 120 },
      tags: [],
    },
    sofa: {
      type: 'sofa',
      labelPrefix: 'Sofa',
      capacity: 4,
      guests: [],
      status: 'open',
      price: null,
      rotation: 0,
      dimensions: { width: 160, height: 70 },
      tags: ['lounge'],
    },
    stage: {
      type: 'stage',
      labelPrefix: 'Stage',
      capacity: 0,
      guests: [],
      status: 'open',
      price: null,
      rotation: 0,
      dimensions: { width: 220, height: 120 },
      tags: ['stage'],
    },
  };

  return templates[type] ?? null;
}

function selectSeat(seatId) {
  state.selectedSeatId = seatId;
  state.selectedSeatIds = [];
  renderSeatDetails();
  const current = getCurrentEvent();
  const element = current?.layout.elements.find((el) => el.id === seatId) ?? null;
  syncEditToolbar(element);
  selectors.canvas.querySelectorAll('.canvas-element').forEach((node) =>
    node.classList.toggle('selected', node.dataset.id === seatId)
  );
}

function updateSeat(seatId, updates) {
  const current = ensureEvent();
  if (!current) return;

  const seat = current.layout.elements.find((el) => el.id === seatId);
  if (!seat) return;

  Object.assign(seat, updates);
  current.audit.push(createAuditEntry('Seat updated', { seatId }));
  persist();
  render();
  toast('Seat updated');
}

function focusGuest(guestId) {
  const current = ensureEvent();
  if (!current) return;

  const guest = current.guests.find((person) => person.id === guestId);
  if (!guest || !guest.seatId) return;

  selectSeat(guest.seatId);
  party.confetti(selectors.seatDetails, {
    count: party.variation.range(12, 18),
    spread: 30,
    velocity: 120,
  });
}

function clearSeatSelection() {
  state.selectedSeatId = null;
  state.selectedSeatIds = [];
  state.multiSelect.active = false;
  state.multiSelect.dragging = false;
  state.multiSelect.anchor = null;
  state.multiSelect.current = null;
  state.multiSelect.previousSelection = [];
  state.multiSelect.hasDragged = false;
  selectors.selectionOverlay?.remove();
  selectors.selectionOverlay = null;
  renderSeatDetails();
  syncEditToolbar();
  selectors.canvas.querySelectorAll('.canvas-element').forEach((node) =>
    node.classList.remove('selected')
  );
}

function adjustZoom(delta) {
  return;
}

function setZoom(value) {
  state.zoom = ZOOM_LIMITS.min;
  applyViewportStyles();
}

function toggleSidebar(open) {
  selectors.sidebar.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-visible', open);

  if (open) {
    const offCanvas = document.createElement('div');
    offCanvas.className = 'off-canvas-backdrop';
    offCanvas.dataset.role = 'sidebar-backdrop';
    offCanvas.addEventListener('click', () => toggleSidebar(false));
    document.body.appendChild(offCanvas);
  } else {
    document.querySelector('[data-role="sidebar-backdrop"]')?.remove();
  }
}

function initializePanelState() {
  applyPanelLayout(panelState);
}

function toggleLeftPanel() {
  panelState.left = panelState.left === 'expanded' ? 'collapsed' : 'expanded';
  applyPanelLayout(panelState);
  persistLayoutState();
}

function toggleRightPanel() {
  panelState.right = panelState.right === 'expanded' ? 'collapsed' : 'expanded';
  applyPanelLayout(panelState);
  persistLayoutState();
}

function applyPanelLayout({ left, right } = {}) {
  const appShell = document.querySelector('.app-shell');
  const workspaceBody = document.querySelector('.workspace-body');
  const sidebar = document.querySelector('.sidebar');
  const detailsPanel = document.querySelector('.details-panel');
  const leftToggle = selectors.leftPanelToggle;
  const rightToggle = selectors.rightPanelToggle;
  const header = document.querySelector('.workspace-header');

  if (left) {
    panelState.left = left;
    sidebar?.classList.toggle('is-collapsed', left === 'collapsed');
    appShell?.setAttribute('data-left-state', left);
    updateLeftToggleLabel(left);
  }

  if (right) {
    panelState.right = right;
    workspaceBody?.setAttribute(
      'data-details-state',
      right === 'expanded' ? 'expanded' : 'collapsed'
    );
    detailsPanel?.classList.toggle('is-collapsed', right === 'collapsed');
    updateRightToggleLabel(right);
  }

  const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
  const offsetTop = Math.max(72, headerBottom + 16);
  document.documentElement.style.setProperty('--panel-toggle-top', `${offsetTop}px`);

  if (leftToggle) {
    leftToggle.classList.toggle('panel-toggle--floating', panelState.left === 'collapsed');
  }

  if (rightToggle) {
    rightToggle.classList.toggle('panel-toggle--floating', panelState.right === 'collapsed');
  }
}

function updateLeftToggleLabel(stateValue) {
  if (!selectors.leftPanelToggle) return;
  const icon = selectors.leftPanelToggle.querySelector('.material-symbol');
  const isCollapsed = stateValue === 'collapsed';
  selectors.leftPanelToggle.setAttribute('aria-expanded', String(!isCollapsed));
  selectors.leftPanelToggle.setAttribute(
    'aria-label',
    isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
  );
  if (icon) {
    icon.textContent = 'chevron_left';
    icon.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
  }
}

function updateRightToggleLabel(stateValue) {
  if (!selectors.rightPanelToggle) return;
  const icon = selectors.rightPanelToggle.querySelector('.material-symbol');
  const isCollapsed = stateValue === 'collapsed';
  selectors.rightPanelToggle.setAttribute('aria-expanded', String(!isCollapsed));
  selectors.rightPanelToggle.setAttribute(
    'aria-label',
    isCollapsed ? 'Expand details' : 'Collapse details'
  );
  if (icon) {
    icon.textContent = 'chevron_left';
    icon.classList.toggle('is-collapsed', isCollapsed);
    icon.style.transform = isCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
  }
}

function persistLayoutState() {
  try {
    const userId = state.auth.user?.id ?? null;
    if (!userId) return;
    const key = getLayoutStorageKeyForUser(userId);
    localStorage.setItem(key, JSON.stringify(panelState));
  } catch (error) {
    console.error('Failed to persist panel layout state', error);
  }
}

function renderPanelToggles() {
  updateLeftToggleLabel(panelState.left);
  updateRightToggleLabel(panelState.right);
}

function ensureDetailsPanelCollapsed() {
  if (panelState.right === 'collapsed') return;
  panelState.right = 'collapsed';
  applyPanelLayout({ right: 'collapsed' });
  persistLayoutState();
}

function ensureDetailsPanelExpanded() {
  if (panelState.right === 'expanded') return;
  panelState.right = 'expanded';
  applyPanelLayout({ right: 'expanded' });
  persistLayoutState();
}

function openImportModal() {
  setModalVisibility(selectors.importModal, true);
}

function closeImportModal() {
  setModalVisibility(selectors.importModal, false);
}

function confirmImport() {
  const fileInput = selectors.importModal.querySelector('#importFile');
  if (!fileInput.files.length) return toast('Add a CSV file');

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = (event) => {
    const text = event.target.result;
    const rows = text.split(/\r?\n/);
    const [header, ...data] = rows;
    if (!header) return toast('Empty file');

    const columns = header.split(',').map((col) => col.trim().toLowerCase());
    const nameIndex = columns.indexOf('name');
    const emailIndex = columns.indexOf('email');
    const tagsIndex = columns.indexOf('tags');

    if (nameIndex === -1) return toast('CSV needs a name column');

    const guests = data
      .map((row) => row.split(',').map((col) => col.trim()))
      .filter((cols) => cols[nameIndex])
      .map((cols) => ({
        id: crypto.randomUUID(),
        name: cols[nameIndex],
        email: emailIndex >= 0 ? cols[emailIndex] : '',
        tags: tagsIndex >= 0 ? cols[tagsIndex].split('|').map((tag) => tag.trim()) : [],
        seatId: null,
        checkIn: { status: 'invited', time: null },
      }));

    const current = ensureEvent();
    if (!current) return;

    current.guests.push(...guests);
    current.audit.push(createAuditEntry(`Imported ${guests.length} guests`));
    persist();
    render();
    toast('Guests imported');
    fileInput.value = '';
    closeImportModal();
  };

  reader.readAsText(file);
}

function setModalVisibility(node, visible) {
  if (!node) return;
  node.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function openPublishModal() {
  const current = ensureEvent();
  if (!current) return;

  renderPublishSummary(current);
  renderPublishPreview(current);
  setModalVisibility(selectors.publishModal, true);
}

function closePublishModal() {
  setModalVisibility(selectors.publishModal, false);
}

function handlePublishConfirm() {
  setModalVisibility(selectors.publishModal, false);
  setModalVisibility(selectors.publishConfirmModal, true);
}

function closePublishConfirmModal() {
  setModalVisibility(selectors.publishConfirmModal, false);
}

function finalizePublishPlan() {
  const current = ensureEvent();
  if (!current) return;

  setModalVisibility(selectors.publishConfirmModal, false);
  toast('Seating plan confirmed for publishing', { tone: 'success' });
  current.audit.push(createAuditEntry('Seating plan published'));
  persistGuestFacingSnapshot(current);
  persist();
}

function persistGuestFacingSnapshot(plan) {
  try {
    const store = JSON.parse(localStorage.getItem(GUEST_PLAN_CACHE_KEY) ?? '{}');
    store[plan.id] = buildGuestPlanSnapshot(plan);
    localStorage.setItem(GUEST_PLAN_CACHE_KEY, JSON.stringify(store));
  } catch (error) {
    console.error('Failed to persist guest snapshot', error);
  }
}

function buildGuestPlanSnapshot(plan) {
  return {
    id: plan.id,
    event: {
      name: plan.name,
      date: plan.date,
      venue: plan.venue,
      description: plan.description,
      layout: {
        elements: deepClone(plan.layout?.elements ?? []),
        dimensions: deepClone(plan.layout?.dimensions ?? { width: 1920, height: 1080 }),
      },
      guests: deepClone(plan.guests ?? []),
    },
  };
}

function deepClone(value) {
  if (value === undefined) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (error) {
      // fall through to JSON clone
    }
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error('Deep clone failed', error);
    return value;
  }
}


function adjustSeatCapacity(seatId, delta) {
  const current = ensureEvent();
  if (!current) return;

  const seat = current.layout.elements.find((el) => el.id === seatId);
  if (!seat) return;

  seat.capacity = Math.max(1, seat.capacity + delta);
  current.audit.push(createAuditEntry('Seat capacity updated', { seatId }));
  persist();
  render();
}

function handleBalanceGuestsByTag(tag) {
  const current = ensureEvent();
  if (!current) return;

  const guests = current.guests.filter((guest) => guest.tags.includes(tag));
  if (!guests.length) return toast(`No guests with tag ${tag}`);

  const seats = current.layout.elements.filter((seat) => seat.tags?.includes(tag));
  if (!seats.length) return toast(`No seats tagged ${tag}`);

  shuffle(guests);
  guests.forEach((guest, index) => {
    const seat = seats[index % seats.length];
    if (!seat.guests.includes(guest.id)) seat.guests.push(guest.id);
    guest.seatId = seat.id;
  });
  current.audit.push(createAuditEntry(`Balanced ${tag} guests`));
  persist();
  render();
}

function ensureEvent() {
  if (!state.selectedEventId) {
    toast('Create or select an event first');
    return null;
  }
  return getCurrentEvent();
}

function toast(message, options = {}) {
  const node = document.createElement('div');
  node.className = `toast ${options.tone ?? ''}`.trim();
  node.textContent = message;
  selectors.toastStack.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 150);
  }, options.duration ?? 2600);
}

function createAuditEntry(message, meta = {}) {
  return {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    message,
    meta,
  };
}

function getGuestName(id) {
  const current = getCurrentEvent();
  const guest = current?.guests.find((person) => person.id === id);
  return guest ? guest.name : 'Unknown';
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function capitalize(value) {
  if (typeof value !== 'string' || !value.length) return '';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value) {
  if (!value) return 'Draft';
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return formatter.format(new Date(value));
  } catch (error) {
    return value;
  }
}

function formatPrice(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
    return formatter.format(Number(value));
  } catch (error) {
    return `$${Number(value).toFixed(0)}`;
  }
}

function clearUserScopedState() {
  cancelAllPlanSyncs();
  state.events = [];
  state.selectedEventId = null;
  state.selectedSeatId = null;
  state.selectedSeatIds = [];
  state.selectionPreview = [];
  state.multiSelect = createInitialMultiSelectState();
  state.currentTool = 'select';
  state.currentIntent = 'layout';
  state.zoom = 1;
  state.viewport = {
    pan: { x: 0, y: 0 },
    offset: { x: STAGE_EXPAND_MARGIN, y: STAGE_EXPAND_MARGIN },
    size: { ...STAGE_MIN_SIZE },
    initialized: false,
    bounds: null,
  };
  state.liveMode = false;
  state.syncing = false;
  state.dragState = null;
  state.lastCanvasPoint = null;
  state.clipboard = null;
  state.rotationHandle = {
    active: false,
    elementId: null,
    dragging: false,
    angle: 0,
  };
  state.contextMenu = {
    visible: false,
    elementId: null,
    position: { x: 0, y: 0 },
  };
  state.form = {
    isDirty: false,
    isHydrating: false,
    lastHydratedEventId: null,
  };
}

function duplicateElement(elementId) {
  const current = ensureEvent();
  if (!current) return;
  const source = current.layout.elements.find((el) => el.id === elementId);
  if (!source) return;
  const id = crypto.randomUUID();
  const clone = {
    ...structuredClone(source),
    id,
    label: `${source.label} copy`,
    position: {
      x: source.position.x + CLONE_OFFSETS.duplicate.x,
      y: source.position.y + CLONE_OFFSETS.duplicate.y,
    },
  };
  if (RESET_TO_OPEN_TYPES.has(clone.type)) {
    clone.status = 'open';
    clone.guests = [];
  }
  clampElementToCanvas(clone);
  current.layout.elements.push(clone);
  current.audit.push(createAuditEntry('Element duplicated', { elementId: id }));
  persist();
  render();
  selectSeat(id);
}

function deleteElement(elementId) {
  const current = ensureEvent();
  if (!current) return;
  const index = current.layout.elements.findIndex((el) => el.id === elementId);
  if (index === -1) return;
  const [removed] = current.layout.elements.splice(index, 1);
  current.audit.push(createAuditEntry('Element removed', { elementId }));

  detachGuestsFromElements(current, removed ? [removed] : []);

  state.selectedSeatId = null;
  persist();
  render();
  toast('Element removed');
}

function deleteElements(ids) {
  const current = ensureEvent();
  if (!current || !ids.length) return;

  const idSet = new Set(ids);
  const beforeElements = current.layout.elements;
  const kept = [];
  let removedCount = 0;
  const removedElements = [];

  beforeElements.forEach((element) => {
    if (idSet.has(element.id)) {
      removedCount += 1;
      removedElements.push(element);
      current.audit.push(createAuditEntry('Element removed', { elementId: element.id }));
      return;
    }
    kept.push(element);
  });

  if (!removedCount) {
    return;
  }

  current.layout.elements = kept;

  detachGuestsFromElements(current, removedElements);

  state.selectedSeatId = null;
  state.selectedSeatIds = [];
  disableMultiSelect();
  persist();
  render();
  toast(`${removedCount} element${removedCount === 1 ? '' : 's'} removed`);
}

function ensureAuthenticated() {
  if (state.auth.user) return true;
  toast('Sign in to manage your plans', { tone: 'error' });
  return false;
}

function detachGuestsFromElements(event, elements) {
  if (!Array.isArray(elements) || !elements.length) return;

  const removedSeatIds = new Set();

  elements.forEach((element) => {
    if (!element) return;
    removedSeatIds.add(element.id);
    if (Array.isArray(element.guests)) {
      element.guests.length = 0;
    }
  });

  if (!removedSeatIds.size || !Array.isArray(event.guests)) return;

  event.guests.forEach((guest) => {
    if (guest.seatId && removedSeatIds.has(guest.seatId)) {
      guest.seatId = null;
    }
  });
}

function applyViewportStyles() {
  const { viewport, stage, scale, layer } = selectors;
  if (!viewport || !stage || !scale || !layer) return;

  const { pan, size, offset } = state.viewport;

  stage.style.width = `${size.width}px`;
  stage.style.height = `${size.height}px`;

  scale.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${state.zoom})`;
  layer.style.transform = `translate(${offset.x}px, ${offset.y}px)`;
}

function ensureViewportInitialized() {
  if (state.viewport.initialized || !selectors.canvas) return;
  const { width, height } = selectors.canvas.getBoundingClientRect();
  state.viewport.pan.x = width / 2 - state.viewport.size.width / 2;
  state.viewport.pan.y = height / 2 - state.viewport.size.height / 2;
  state.viewport.initialized = true;
}

function updateStageBounds(elements, explicitDimensions) {
  ensureViewportInitialized();
  const previousOffset = {
    x: Number.isFinite(state.viewport.offset?.x) ? state.viewport.offset.x : STAGE_EXPAND_MARGIN,
    y: Number.isFinite(state.viewport.offset?.y) ? state.viewport.offset.y : STAGE_EXPAND_MARGIN,
  };
  const hadBounds = Boolean(state.viewport.bounds);
  const normalizedDimensions = normalizeSiteDimensions(explicitDimensions);

  if ((!elements.length && !explicitDimensions) || explicitDimensions === null) {
    state.viewport.size = { ...STAGE_MIN_SIZE };
    state.viewport.offset = {
      x: STAGE_EXPAND_MARGIN,
      y: STAGE_EXPAND_MARGIN,
    };
    state.viewport.bounds = null;
    autoAnchorCenter();
    return;
  }

  if (normalizedDimensions.width && normalizedDimensions.height) {
    const padded = padExplicitDimensions(normalizedDimensions);
    state.viewport.size = {
      width: padded.width,
      height: padded.height,
    };
    state.viewport.offset = {
      x: STAGE_EXPAND_MARGIN,
      y: STAGE_EXPAND_MARGIN,
    };
    state.viewport.bounds = createBoundsFromDimensions(normalizedDimensions);
    autoAnchorCenter();
    return;
  }

  const bounds = elements.reduce(
    (acc, element) => {
      const right = element.position.x + element.dimensions.width;
      const bottom = element.position.y + element.dimensions.height;
      return {
        minX: Math.min(acc.minX, element.position.x),
        minY: Math.min(acc.minY, element.position.y),
        maxX: Math.max(acc.maxX, right),
        maxY: Math.max(acc.maxY, bottom),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );

  state.viewport.bounds = bounds;

  const width = Math.max(
    bounds.maxX - bounds.minX + STAGE_EXPAND_MARGIN * 2,
    STAGE_MIN_SIZE.width
  );
  const height = Math.max(
    bounds.maxY - bounds.minY + STAGE_EXPAND_MARGIN * 2,
    STAGE_MIN_SIZE.height
  );

  state.viewport.size = { width, height };

  const baseOffset = {
    x: STAGE_EXPAND_MARGIN + Math.max(0, -bounds.minX),
    y: STAGE_EXPAND_MARGIN + Math.max(0, -bounds.minY),
  };
  const nextOffset = {
    x: Math.max(baseOffset.x, previousOffset.x),
    y: Math.max(baseOffset.y, previousOffset.y),
  };
  const offsetChanged =
    nextOffset.x !== previousOffset.x || nextOffset.y !== previousOffset.y;

  state.viewport.offset = nextOffset;

  if (offsetChanged && hadBounds) {
    adjustPanForOffsetChange(previousOffset);
  } else if (!hadBounds) {
    autoAnchorCenter();
  }
}

function padExplicitDimensions(dimensions) {
  const normalized = normalizeSiteDimensions(dimensions);
  return {
    width: Math.max(normalized.width + STAGE_EXPAND_MARGIN * 2, STAGE_MIN_SIZE.width),
    height: Math.max(normalized.height + STAGE_EXPAND_MARGIN * 2, STAGE_MIN_SIZE.height),
  };
}

function createBoundsFromDimensions(dimensions) {
  const normalized = normalizeSiteDimensions(dimensions);
  return {
    minX: 0,
    minY: 0,
    maxX: normalized.width,
    maxY: normalized.height,
  };
}

function adjustPanForOffsetChange(previousOffset = {}) {
  if (!previousOffset) return;
  const nextOffset = state.viewport.offset ?? {};

  const prevX = Number.isFinite(previousOffset.x) ? previousOffset.x : 0;
  const prevY = Number.isFinite(previousOffset.y) ? previousOffset.y : 0;
  const nextX = Number.isFinite(nextOffset.x) ? nextOffset.x : 0;
  const nextY = Number.isFinite(nextOffset.y) ? nextOffset.y : 0;

  if (!Number.isFinite(state.viewport.pan.x)) state.viewport.pan.x = 0;
  if (!Number.isFinite(state.viewport.pan.y)) state.viewport.pan.y = 0;

  const deltaX = (prevX - nextX) / state.zoom;
  const deltaY = (prevY - nextY) / state.zoom;

  if (Number.isFinite(deltaX) && deltaX) {
    state.viewport.pan.x += deltaX;
  }
  if (Number.isFinite(deltaY) && deltaY) {
    state.viewport.pan.y += deltaY;
  }
}

function handleViewportPointerDown(event) {
  if (event.button !== 0) return;
  selectors.viewport?.setPointerCapture(event.pointerId);
  state.dragState = {
    id: null,
    startX: event.clientX,
    startY: event.clientY,
    origin: { ...state.viewport.pan },
    type: 'pan',
  };
}

function handleViewportPointerMove(event) {
  if (!state.dragState || state.dragState.type !== 'pan') return;
  const deltaX = (event.clientX - state.dragState.startX) / state.zoom;
  const deltaY = (event.clientY - state.dragState.startY) / state.zoom;
  state.viewport.pan.x = state.dragState.origin.x + deltaX;
  state.viewport.pan.y = state.dragState.origin.y + deltaY;
  applyViewportStyles();
}

function handleViewportPointerUp(event) {
  if (state.dragState?.type === 'pan') {
    selectors.viewport?.releasePointerCapture(event.pointerId);
    state.dragState = null;
    persist();
  }
}

function handleViewportWheel(event) {
  if (!selectors.viewport) return;
  const delta = event.deltaY;
  if (delta === 0) return;

  event.preventDefault();

  const scaleFactor = delta > 0 ? 1 / ZOOM_WHEEL_FACTOR : ZOOM_WHEEL_FACTOR;
  const zoom = state.zoom * scaleFactor;

  const focus = screenToStagePoint(event.clientX, event.clientY);
  state.lastCanvasPoint = { ...focus };
  setZoom(zoom);
}

function syncEditToolbar(element) {
  if (!selectors.editToolbar) return;

  const hasSingleSelection = Boolean(element);
  const hasMultiSelection = state.selectedSeatIds.length > 1;
  const hasSelection = hasSingleSelection || hasMultiSelection;
  const clipboardHasData = Boolean(state.clipboard);

  toggleToolbarEnabled(selectors.rotationInput, hasSingleSelection && !hasMultiSelection);
  toggleToolbarEnabled(selectors.rotateButton, hasSingleSelection && !hasMultiSelection);
  toggleToolbarEnabled(selectors.handleButton, hasSingleSelection && !hasMultiSelection);
  toggleToolbarEnabled(selectors.copyButton, hasSelection);
  toggleToolbarEnabled(selectors.duplicateButton, hasSelection);
  toggleToolbarEnabled(selectors.deleteButton, hasSelection || hasMultiSelection);
  toggleToolbarEnabled(selectors.bringFrontButton, hasSingleSelection);
  toggleToolbarEnabled(selectors.sendBackButton, hasSingleSelection);
  toggleToolbarEnabled(selectors.pasteButton, clipboardHasData);

  if (selectors.contextMenu) {
    selectors.contextMenu.querySelectorAll('[data-menu-action]').forEach((btn) => {
      const action = btn.dataset.menuAction;
      const shouldEnable =
        action === EDIT_ACTIONS.PASTE ? clipboardHasData : hasSelection;
      btn.disabled = !shouldEnable;
    });
  }

  if (!hasSelection) {
    hideRotationHandle();
  } else {
    if (hasSingleSelection && element && selectors.rotationInput) {
      selectors.rotationInput.value = Number(element.rotation || 0).toFixed(0);
    }
    if (
      hasSingleSelection &&
      element &&
      state.rotationHandle.active &&
      state.rotationHandle.elementId !== element.id
    ) {
      state.rotationHandle.elementId = element.id;
      updateRotationHandle();
    }
  }
}

function toggleToolbarEnabled(target, enabled) {
  if (!target) return;
  target.disabled = !enabled;
  if (target === selectors.handleButton && !enabled) {
    target.setAttribute('aria-pressed', 'false');
  }
}

window.addEventListener('beforeunload', persist);

function handleEventCardContextMenu(event, eventId) {
  event.preventDefault();
  showPlanContextMenu({ eventId, x: event.clientX, y: event.clientY });
}

function showPlanContextMenu({ eventId, x, y }) {
  removePlanContextMenu();

  const menu = document.createElement('div');
  menu.className = 'plan-context-menu';
  menu.setAttribute('role', 'menu');
  menu.dataset.eventId = eventId;
  menu.innerHTML = `
    <button type="button" data-plan-action="delete">
      <span class="material-symbol">delete</span>
      Delete plan
    </button>
  `;

  menu.querySelector('[data-plan-action="delete"]').addEventListener('click', () => {
    deleteEvent(eventId);
    removePlanContextMenu();
  });

  positionPlanMenu(menu, x, y);
  document.body.appendChild(menu);
  menu.focus({ preventScroll: true });

  const handleOutsideClick = (event) => {
    if (!menu.contains(event.target)) {
      removePlanContextMenu();
    }
  };

  const handleEscape = (event) => {
    if (event.key === 'Escape') {
      removePlanContextMenu();
    }
  };

  document.addEventListener('mousedown', handleOutsideClick, { capture: true });
  document.addEventListener('keydown', handleEscape);

  activePlanMenu = {
    node: menu,
    handlers: { handleOutsideClick, handleEscape },
  };
}

function positionPlanMenu(menu, clientX, clientY) {
  const padding = 8;
  const { innerWidth, innerHeight } = window;
  const rect = menu.getBoundingClientRect();
  const width = rect.width || 160;
  const height = rect.height || 80;

  const left = Math.min(clientX, innerWidth - width - padding);
  const top = Math.min(clientY, innerHeight - height - padding);

  menu.style.left = `${Math.max(padding, left)}px`;
  menu.style.top = `${Math.max(padding, top)}px`;
}

function removePlanContextMenu() {
  if (!activePlanMenu) return;
  const { node, handlers } = activePlanMenu;
  node.remove();
  document.removeEventListener('mousedown', handlers.handleOutsideClick, { capture: true });
  document.removeEventListener('keydown', handlers.handleEscape);
  activePlanMenu = null;
}

function deleteEvent(eventId) {
  deletePlans([eventId]);
}

function handleDeleteAllEvents() {
  if (!state.events.length) {
    toast('No plans to delete');
    return;
  }

  const confirmed = confirm('Delete all plans? This cannot be undone.');
  if (!confirmed) return;

  const ids = state.events.map((event) => event.id);
  deletePlans(ids);
}

function createElementContextMenuMarkup() {
  return `
    <button type="button" data-menu-action="rotate" role="menuitem">
      <span class="material-symbol">refresh</span>
      Rotate to angle
    </button>
    <button type="button" data-menu-action="toggle-handle" role="menuitem">
      <span class="material-symbol">adjust</span>
      Manual rotate
    </button>
    <hr />
    <button type="button" data-menu-action="copy" role="menuitem">
      <span class="material-symbol">content_copy</span>
      Copy
    </button>
    <button type="button" data-menu-action="paste" role="menuitem">
      <span class="material-symbol">content_paste</span>
      Paste
    </button>
    <button type="button" data-menu-action="duplicate" role="menuitem">
      <span class="material-symbol">control_point_duplicate</span>
      Duplicate
    </button>
    <button type="button" data-menu-action="delete" role="menuitem">
      <span class="material-symbol">delete</span>
      Delete
    </button>
    <hr />
    <button type="button" data-menu-action="bring-front" role="menuitem">
      <span class="material-symbol">flip_to_front</span>
      Bring to front
    </button>
    <button type="button" data-menu-action="send-back" role="menuitem">
      <span class="material-symbol">flip_to_back</span>
      Send to back
    </button>
  `;
}

function openDatePicker() {
  if (selectors.eventDateNative) {
    selectors.eventDateNative.showPicker?.();
    selectors.eventDateNative.focus();
  } else if (selectors.eventDate) {
    selectors.eventDate.showPicker?.();
    selectors.eventDate.focus();
  }
}

function updateDateDisplay() {
  const value = resolveEventDateValue();
  if (!value) {
    selectors.eventDateDisplay.textContent = 'Select date & time';
    selectors.openEventDatePicker?.classList.remove('has-value');
    return;
  }

  try {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid date');
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
    selectors.eventDateDisplay.textContent = formatter.format(date);
    selectors.openEventDatePicker?.classList.add('has-value');
  } catch (error) {
    console.warn('Failed to format date', error);
    selectors.eventDateDisplay.textContent = value;
    selectors.openEventDatePicker?.classList.add('has-value');
  }
}

function resolveEventDateValue() {
  return selectors.eventDateNative?.value ?? selectors.eventDate?.value ?? '';
}

function handleCapacityStep(event) {
  const step = Number.parseInt(event.currentTarget.dataset.capacityStep, 10);
  if (!Number.isFinite(step)) return;
  const input = selectors.eventCapacity;
  if (!input) return;
  const current = Number.parseInt(input.value, 10) || Number.parseInt(input.dataset.default ?? '1', 10);
  const updated = Math.max(1, current + step);
  input.value = String(updated);
}

function sanitizeCapacityInput(event) {
  const digits = event.target.value.replace(/[^0-9]/g, '');
  event.target.value = digits;
}

function enforceCapacityBounds(event) {
  const value = Number.parseInt(event.target.value, 10);
  if (!Number.isInteger(value) || value <= 0) {
    event.target.value = event.target.dataset.default ?? '120';
  }
}

function sanitizeDimensionInput(event) {
  const cleaned = event.target.value.replace(/[^0-9.]/g, '');
  const normalized = cleaned.replace(/(\..*?)\./g, '$1');
  event.target.value = normalized;
}

function enforceDimensionBounds(event) {
  const value = Number.parseFloat(event.target.value);
  if (!Number.isFinite(value) || value <= 0) {
    if (event.target.id === 'siteWidth') {
      event.target.value = String(DEFAULT_SITE_DIMENSIONS.width);
    } else if (event.target.id === 'siteHeight') {
      event.target.value = String(DEFAULT_SITE_DIMENSIONS.height);
    } else {
      event.target.value = '';
    }
  }
}

function noop() {}

function markFormDirty() {
  if (state.form.isHydrating) return;
  state.form.isDirty = true;
}

async function createPlan(input) {
  if (!ensureAuthenticated()) return;
  const plan = buildPlanObject({ ...input, layout: normalizeLayout(input.layout) });
  if (!supabase) {
    applyPlanCreate(plan);
    return plan.id;
  }

  try {
    const payload = buildPlanPayload(plan);
    const { data, error } = await supabase
      .from('plans')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    applyPlanCreate(buildPlanObject(data?.event ?? plan));
    return data?.id ?? plan.id;
  } catch (error) {
    console.error('createPlan failed', error);
    toast(error.message ?? 'Could not create plan', { tone: 'error' });
    throw error;
  }
}

async function updatePlan(planId, patches, options = {}) {
  if (!ensureAuthenticated()) return;
  const current = state.events.find((plan) => plan.id === planId);
  if (!current) return;
  Object.assign(current, patches);
  persist({ skipRemoteSchedule: true });
  render();

  const { skipRemote = false } = options;

  if (!supabase || skipRemote) return;

  setSyncIndicator(true);

  try {
    await pushPlanToSupabase(planId, current);
  } catch (error) {
    console.error('updatePlan failed', error);
    toast('Could not save the plan', { tone: 'error' });
  } finally {
    if (!remoteSyncState.planTimers.size) setSyncIndicator(false);
  }
}

async function loadPlans() {
  if (!ensureAuthenticated()) return;
  try {
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .eq('user_id', state.auth.user.id)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    hydratePlansFromRemote(data ?? []);
    render();
  } catch (error) {
    console.error('loadPlans failed', error);
    toast('Could not load your plans from Supabase', { tone: 'error' });
  }
}

async function deletePlans(ids) {
  if (!ensureAuthenticated() || !Array.isArray(ids) || !ids.length) return;
  removePlansLocally(ids);

  if (!supabase) return;

  try {
    const { error } = await supabase
      .from('plans')
      .delete()
      .in('id', ids)
      .eq('user_id', state.auth.user.id);
    if (error) throw error;
  } catch (error) {
    console.error('deletePlans failed', error);
    toast('Could not delete plans', { tone: 'error' });
  }
}

function buildPlanPayload(raw, id = raw?.id ?? crypto.randomUUID()) {
  const normalizedLayout = normalizeLayout(raw.layout ?? { elements: [] });
  return {
    id,
    user_id: state.auth.user?.id,
    name: raw.name,
    event: {
      id,
      name: raw.name,
      date: raw.date,
      venue: raw.venue ?? '',
      capacity: raw.capacity ?? 0,
      guests: raw.guests ?? [],
      layout: normalizedLayout,
      audit: raw.audit ?? [],
      shareUrl: raw.shareUrl ?? null,
    },
  };
}

function buildPlanObject(raw) {
  if (!raw) {
    return {
      id: crypto.randomUUID(),
      name: 'Untitled plan',
      date: new Date().toISOString(),
      venue: '',
      capacity: 0,
      guests: [],
      layout: { elements: [], dimensions: DEFAULT_SITE_PIXELS },
      audit: [createAuditEntry('Plan created')],
      shareUrl: null,
    };
  }

  const id = raw.id ?? raw.event?.id ?? crypto.randomUUID();
  const event = raw.event ?? raw;
  const dimensions = normalizeSiteDimensions(event.layout?.dimensions);
  return {
    id,
    name: event.name ?? 'Untitled plan',
    date: event.date ?? new Date().toISOString(),
    venue: event.venue ?? '',
    capacity: event.capacity ?? 0,
    guests: Array.isArray(event.guests) ? event.guests : [],
    layout: normalizeLayout({ ...event.layout, dimensions }),
    audit: Array.isArray(event.audit) ? event.audit : [createAuditEntry('Plan imported')],
    shareUrl: event.shareUrl ?? null,
  };
}

function normalizeLayout(layout = { elements: [] }) {
  const dimensions = normalizeSiteDimensions(layout.dimensions);
  return {
    elements: Array.isArray(layout.elements) ? layout.elements : [],
    dimensions,
  };
}

function normalizeSiteDimensions(dimensions) {
  if (!dimensions || typeof dimensions !== 'object') {
    return buildSiteDimensions(DEFAULT_SITE_DIMENSIONS);
  }

  if (dimensions.meters) {
    const unit = dimensions.unit ?? DEFAULT_SITE_DIMENSIONS.unit;
    const width = Number.isFinite(dimensions.meters.width)
      ? dimensions.meters.width
      : DEFAULT_SITE_DIMENSIONS.width;
    const height = Number.isFinite(dimensions.meters.height)
      ? dimensions.meters.height
      : DEFAULT_SITE_DIMENSIONS.height;
    return buildSiteDimensions({ width, height, unit });
  }

  const scale = SITE_UNIT_SCALES[dimensions.unit] ?? SITE_UNIT_SCALES[DEFAULT_SITE_DIMENSIONS.unit];
  const width = Number.isFinite(dimensions.width) && dimensions.width > 0
    ? dimensions.width / scale
    : DEFAULT_SITE_DIMENSIONS.width;
  const height = Number.isFinite(dimensions.height) && dimensions.height > 0
    ? dimensions.height / scale
    : DEFAULT_SITE_DIMENSIONS.height;
  const unit = dimensions.unit ?? DEFAULT_SITE_DIMENSIONS.unit;
  return buildSiteDimensions({ width, height, unit });
}

function applyPlanCreate(row) {
  const event = buildPlanObject(row);
  state.events.unshift(event);
  state.selectedEventId = event.id;
  persist();
  render();
}

function hydratePlansFromRemote(rows) {
  state.events = rows.map((row) => buildPlanObject(row.event ?? row));
  state.selectedEventId = state.events[0]?.id ?? null;
  persist();
}

function removePlansLocally(ids) {
  const idSet = new Set(ids);
  state.events = state.events.filter((plan) => !idSet.has(plan.id));
  if (state.events.every((plan) => plan.id !== state.selectedEventId)) {
    state.selectedEventId = state.events[0]?.id ?? null;
  }
  persist();
  render();
}

async function pushPlanToSupabase(planId, plan) {
  if (!supabase || !planId || !plan) return;
  const payload = buildPlanPayload(plan, planId);
  const { error } = await supabase
    .from('plans')
    .update(payload)
    .eq('id', planId)
    .eq('user_id', state.auth.user.id);
  if (error) throw error;
}

function ensureShareUrl(plan) {
  if (plan.shareUrl) return plan.shareUrl;
  const url = generateShareUrl(plan.id);
  plan.shareUrl = url;
  return url;
}

function generateShareUrl(planId) {
  return `${BASE_URL}customer.html?plan=${encodeURIComponent(planId)}`;
}

function regenerateShareLink() {
  const current = ensureEvent();
  if (!current) return;

  current.shareUrl = generateShareUrl(current.id);
  persist();
  renderPublishSummary(current);
  toast('Customer link regenerated', { tone: 'success' });
}

async function copyShareUrlToClipboard() {
  const current = ensureEvent();
  if (!current?.shareUrl) {
    toast('Generate the share link first');
    return;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(current.shareUrl);
      toast('Link copied to clipboard', { tone: 'success' });
      return;
    }
  } catch (error) {
    console.error('Copy failed', error);
  }
  fallbackCopyText(current.shareUrl);
}

function copyPlanShareLink(planId) {
  const plan = state.events.find((event) => event.id === planId);
  if (!plan) return;
  if (!plan.shareUrl) {
    plan.shareUrl = generateShareUrl(plan.id);
    persist();
  }
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(plan.shareUrl)
      .then(() => toast('Link copied to clipboard', { tone: 'success' }))
      .catch((error) => {
        console.error('Copy failed', error);
        fallbackCopyText(plan.shareUrl);
      });
  } else {
    fallbackCopyText(plan.shareUrl);
  }
}

function fallbackCopyText(value) {
  const tempInput = document.createElement('input');
  tempInput.value = value;
  document.body.appendChild(tempInput);
  tempInput.select();
  try {
    document.execCommand('copy');
    toast('Link copied to clipboard', { tone: 'success' });
  } catch (error) {
    console.error('Fallback copy failed', error);
    toast('Could not copy link', { tone: 'error' });
  } finally {
    tempInput.remove();
  }
}

const assignmentsMapState = {
  context: null,
  devicePixelRatio: Math.min(window.devicePixelRatio || 1, 3),
  resizeHandlerAttached: false,
};

function resetAssignmentsMap() {
  const {
    assignmentsMapOverlay,
    assignmentsMapAvailable,
    assignmentsMapReserved,
    assignmentsMapTotal,
  } = selectors;
  assignmentsMapOverlay?.classList.add('is-visible');
  if (assignmentsMapAvailable) assignmentsMapAvailable.textContent = '0';
  if (assignmentsMapReserved) assignmentsMapReserved.textContent = '0';
  if (assignmentsMapTotal) assignmentsMapTotal.textContent = '0';
  clearAssignmentsMap();
}

function renderAssignmentsMap(plan) {
  const {
    assignmentsMapSection,
    assignmentsMapCanvas,
    assignmentsMapOverlay,
    assignmentsMapAvailable,
    assignmentsMapReserved,
    assignmentsMapTotal,
  } = selectors;

  if (!assignmentsMapSection || !assignmentsMapCanvas || !assignmentsMapOverlay) {
    return;
  }

  if (!plan) {
    resetAssignmentsMap();
    return;
  }

  const totals = calculateAssignmentStats(plan);
  if (assignmentsMapAvailable) assignmentsMapAvailable.textContent = `${totals.open}`;
  if (assignmentsMapReserved) assignmentsMapReserved.textContent = `${totals.reserved}`;
  if (assignmentsMapTotal) assignmentsMapTotal.textContent = `${totals.capacity}`;

  const layoutHasElements = Array.isArray(plan.layout?.elements) && plan.layout.elements.length > 0;

  const context = ensureAssignmentsMapContext();
  resizeAssignmentsMap();
  if (context) {
    drawAssignmentsMap(plan);
  }

  assignmentsMapOverlay.classList.toggle('is-visible', !layoutHasElements);
}

function ensureAssignmentsMapContext() {
  const { assignmentsMapCanvas } = selectors;
  if (!assignmentsMapCanvas) return null;
  if (assignmentsMapState.context) return assignmentsMapState.context;
  const context = assignmentsMapCanvas.getContext('2d');
  if (!context) return null;
  assignmentsMapState.context = context;

  if (!assignmentsMapState.resizeHandlerAttached) {
    window.addEventListener('resize', handleAssignmentsMapResize, { passive: true });
    assignmentsMapState.resizeHandlerAttached = true;
  }
  return context;
}

function handleAssignmentsMapResize() {
  if (state.currentIntent !== 'assignments') return;
  resizeAssignmentsMap();
  const current = getCurrentEvent();
  if (!current) {
    resetAssignmentsMap();
    return;
  }
  drawAssignmentsMap(current);
}

function clearAssignmentsMap() {
  const canvas = selectors.assignmentsMapCanvas;
  const context = assignmentsMapState.context;
  if (!canvas || !context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function resizeAssignmentsMap() {
  const canvas = selectors.assignmentsMapCanvas;
  const context = assignmentsMapState.context;
  if (!canvas || !context) return;

  const frame = selectors.assignmentsMapSection?.querySelector('[data-assignments-map-frame]');
  if (!frame) return;

  const rect = frame.getBoundingClientRect();
  const styles = window.getComputedStyle(frame);
  const paddingX = parseFloat(styles.paddingLeft ?? '0') + parseFloat(styles.paddingRight ?? '0');
  const paddingY = parseFloat(styles.paddingTop ?? '0') + parseFloat(styles.paddingBottom ?? '0');

  const innerWidth = Math.max(rect.width - paddingX, 320);
  const innerHeight = Math.max(rect.height - paddingY, 320);
  const ratio = assignmentsMapState.devicePixelRatio;

  canvas.width = innerWidth * ratio;
  canvas.height = innerHeight * ratio;
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function drawAssignmentsMap(plan) {
  const canvas = selectors.assignmentsMapCanvas;
  const context = assignmentsMapState.context;
  if (!canvas || !context || !plan) return;

  const layout = plan.layout ?? { elements: [], dimensions: DEFAULT_SITE_PIXELS };
  const elements = Array.isArray(layout.elements) ? layout.elements : [];

  context.save();
  context.clearRect(0, 0, canvas.width, canvas.height);

  if (!elements.length) {
    context.restore();
    return;
  }

  const dimensions = layout.dimensions ?? DEFAULT_SITE_PIXELS;
  const ratio = assignmentsMapState.devicePixelRatio;
  const padding = 32;
  const availableWidth = Math.max(canvas.width / ratio - padding * 2, 120);
  const availableHeight = Math.max(canvas.height / ratio - padding * 2, 120);
  const scaleX = availableWidth / Math.max(dimensions.width, 1);
  const scaleY = availableHeight / Math.max(dimensions.height, 1);
  const scale = Math.min(scaleX, scaleY);

  const offsetX = padding + Math.max((availableWidth - dimensions.width * scale) / 2, 0);
  const offsetY = padding + Math.max((availableHeight - dimensions.height * scale) / 2, 0);

  elements.forEach((element) => {
    drawAssignmentsMapElement(context, element, offsetX, offsetY, scale);
  });

  context.restore();
}

function drawAssignmentsMapElement(context, element, offsetX, offsetY, scale) {
  if (!element?.position || !element?.dimensions) return;

  const palette = resolveAssignmentsMapPalette(element);
  const { position, dimensions } = element;
  const x = offsetX + position.x * scale;
  const y = offsetY + position.y * scale;
  const width = dimensions.width * scale;
  const height = dimensions.height * scale;

  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.rotate(((element.rotation ?? 0) * Math.PI) / 180);
  context.translate(-(x + width / 2), -(y + height / 2));

  context.fillStyle = palette.fill;
  context.strokeStyle = palette.stroke;
  context.lineWidth = Math.max(1, 2 / scale);

  const radius = Math.min(width, height) / 4;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
  context.fill();
  context.stroke();

  if (element.type === 'seat' && element.label) {
    context.fillStyle = palette.text;
    context.font = `${Math.max(10, Math.min(width, height) / 2.5)}px 'Inter', sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(element.label, x + width / 2, y + height / 2);
  }

  context.restore();
}

function resolveAssignmentsMapPalette(element) {
  if (!element) {
    return {
      fill: 'rgba(148, 163, 184, 0.18)',
      stroke: 'rgba(148, 163, 184, 0.45)',
      text: 'rgba(15, 23, 42, 0.9)',
    };
  }

  if (element.type === 'seat') {
    const status = String(element.status ?? 'open').toLowerCase();
    const palettes = {
      open: {
        fill: 'rgba(34, 197, 94, 0.16)',
        stroke: 'rgba(34, 197, 94, 0.48)',
        text: 'rgba(15, 23, 42, 0.88)',
      },
      reserved: {
        fill: 'rgba(248, 113, 113, 0.16)',
        stroke: 'rgba(248, 113, 113, 0.45)',
        text: 'rgba(127, 29, 29, 0.9)',
      },
      occupied: {
        fill: 'rgba(249, 115, 22, 0.12)',
        stroke: 'rgba(249, 115, 22, 0.45)',
        text: 'rgba(120, 53, 15, 0.9)',
      },
      blocked: {
        fill: 'rgba(148, 163, 184, 0.15)',
        stroke: 'rgba(148, 163, 184, 0.4)',
        text: 'rgba(71, 85, 105, 0.9)',
      },
      vip: {
        fill: 'rgba(139, 92, 246, 0.18)',
        stroke: 'rgba(139, 92, 246, 0.42)',
        text: 'rgba(91, 33, 182, 0.9)',
      },
    };
    return palettes[status] ?? palettes.open;
  }

  const defaults = {
    table: {
      fill: 'rgba(148, 163, 184, 0.2)',
      stroke: 'rgba(148, 163, 184, 0.48)',
      text: 'rgba(15, 23, 42, 0.85)',
    },
    sofa: {
      fill: 'rgba(244, 114, 182, 0.18)',
      stroke: 'rgba(244, 114, 182, 0.42)',
      text: 'rgba(131, 24, 67, 0.82)',
    },
    stage: {
      fill: 'rgba(125, 211, 252, 0.2)',
      stroke: 'rgba(59, 130, 246, 0.42)',
      text: 'rgba(12, 74, 110, 0.82)',
    },
    default: {
      fill: 'rgba(226, 232, 240, 0.32)',
      stroke: 'rgba(148, 163, 184, 0.45)',
      text: 'rgba(15, 23, 42, 0.8)',
    },
  };

  return defaults[element.type] ?? defaults.default;
}

