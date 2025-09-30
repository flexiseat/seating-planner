import { authClient } from './supabase.js';

const LOCAL_PLAN_KEY = 'flowSeat:lastPublishedPlan';

const selectors = {
  shell: document.querySelector('#customerShell'),
  loadingState: document.querySelector('#customerLoadingState'),
  errorState: document.querySelector('#customerErrorState'),
  hero: document.querySelector('#customerHero'),
  content: document.querySelector('#customerContent'),
  about: document.querySelector('#customerAbout'),
  eventName: document.querySelector('#customerEventName'),
  eventSummary: document.querySelector('#customerEventSummary'),
  eventDescription: document.querySelector('#customerEventDescription'),
  eventVenue: document.querySelector('#customerEventVenue'),
  eventDate: document.querySelector('#customerEventDate'),
  statsAvailable: document.querySelector('#customerStatsAvailable'),
  statsReserved: document.querySelector('#customerStatsReserved'),
  statsTotal: document.querySelector('#customerStatsTotal'),
  canvas: document.querySelector('#customerCanvas'),
  stageOverlay: document.querySelector('#customerStageOverlay'),
  seatPanel: document.querySelector('#seatPanel'),
  seatPreview: document.querySelector('#seatPreview'),
  seatPreviewImage: document.querySelector('#seatPreviewImage'),
  seatPreviewMeta: document.querySelector('#seatPreviewMeta'),
  checkoutForm: document.querySelector('#checkoutForm'),
  attendeeName: document.querySelector('#attendeeName'),
  attendeeEmail: document.querySelector('#attendeeEmail'),
  buySeatButton: document.querySelector('#buySeatButton'),
  checkoutNote: document.querySelector('#checkoutNote'),
  toastStack: document.querySelector('#customerToastStack'),
  loginOverlay: document.querySelector('#customerLoginOverlay'),
  loginButton: document.querySelector('#customerLoginButton'),
  logoutButton: document.querySelector('#customerLogoutButton'),
  modalCloseButtons: document.querySelectorAll('[data-action="closeCustomerLogin"]'),
  googleLoginButton: document.querySelector('#customerGoogleLogin'),
  loginError: document.querySelector('#customerLoginError'),
};

const state = {
  planId: null,
  user: null,
  event: null,
  seats: [],
  selectedSeatId: null,
  canvasContext: null,
  selectionPattern: null,
  scale: 1,
  devicePixelRatio: Math.min(window.devicePixelRatio || 1, 2),
  publishedSnapshot: null,
};

const SELECTABLE_SEAT_STATUS = new Set(['open']);

function isSelectableSeat(seat) {
  return Boolean(seat && (seat.type ?? 'seat') === 'seat' && SELECTABLE_SEAT_STATUS.has(seat.status));
}

const supabase = authClient.client;

bootstrap();

async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const planId = params.get('plan');

  if (!planId) {
    renderError('This guest link is missing the plan identifier. Please contact the organizer.');
    return;
  }

  state.planId = planId;

  bindUI();
  await hydrateSession();
  await loadEvent(planId);
}

function bindUI() {
  selectors.loginButton?.addEventListener('click', openLoginOverlay);
  selectors.logoutButton?.addEventListener('click', handleLogout);
  selectors.modalCloseButtons?.forEach((button) =>
    button.addEventListener('click', closeLoginOverlay)
  );
  selectors.googleLoginButton?.addEventListener('click', handleGoogleLogin);
  selectors.buySeatButton?.addEventListener('click', handleSeatReservation);

  selectors.canvas?.addEventListener('mousemove', handleSeatHover);
  selectors.canvas?.addEventListener('mouseleave', () => clearSeatPreview());

  window.addEventListener('resize', debounce(resizeCanvas, 150));
  resizeCanvas();
}

async function hydrateSession() {
  const session = await authClient.bootstrap((newSession) => {
    state.user = authClient.mapUser(newSession);
    renderAuthState();
  });
  state.user = authClient.mapUser(session);
  renderAuthState();
}

async function loadEvent(planId) {
  if (supabase) {
    await loadEventFromSupabase(planId);
    return;
  }

  const snapshot = loadPlanFromCache(planId);
  if (!snapshot) {
    renderError('We could not locate the published seating plan. Make sure the organizer has published and shared the latest link.');
    return;
  }

  applySnapshot(snapshot);
}

async function loadEventFromSupabase(planId) {
  toggleLoading(true);

  try {
    const { data, error } = await supabase
      .from('plans')
      .select('*')
      .eq('id', planId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      renderError('We cannot find this seating plan. The link may have expired.');
      return;
    }

    persistGuestSnapshot(planId, data);
    applySnapshot(data);
  } catch (error) {
    console.error('Customer load failed', error);
    const fallback = loadPlanFromCache(planId);
    if (fallback) {
      applySnapshot(fallback);
      toast('Showing most recent saved plan. Live updates unavailable.', { tone: 'info', duration: 3600 });
    } else {
      renderError('We ran into an issue loading this seating plan. Try refreshing the page.');
    }
  } finally {
    toggleLoading(false);
  }
}

function loadPlanFromCache(planId) {
  try {
    const store = JSON.parse(localStorage.getItem(LOCAL_PLAN_KEY) ?? '{}');
    return store[planId] ?? null;
  } catch (error) {
    console.error('Failed reading local plan cache', error);
    return null;
  }
}

function persistGuestSnapshot(planId, data) {
  try {
    const store = JSON.parse(localStorage.getItem(LOCAL_PLAN_KEY) ?? '{}');
    store[planId] = data;
    localStorage.setItem(LOCAL_PLAN_KEY, JSON.stringify(store));
  } catch (error) {
    console.error('Failed persisting guest snapshot', error);
  }
}

function applySnapshot(rawPlan) {
  const snapshot = normalizePlan(rawPlan);
  state.publishedSnapshot = snapshot;
  state.event = snapshot.event;
  state.seats = snapshot.event.layout.elements ?? [];
  toggleLoading(false);
  renderEvent();
  scheduleCanvasRefresh();
}

function normalizePlan(plan) {
  if (!plan) {
    return {
      event: normalizeEvent(null),
    };
  }
  const eventPayload = plan.event ?? plan;
  const event = normalizeEvent(eventPayload);
  return {
    event,
  };
}

function normalizeEvent(raw) {
  const fallback = {
    name: 'Untitled event',
    date: null,
    venue: 'Venue TBA',
    layout: { elements: [], dimensions: { width: 1920, height: 1080 } },
    guests: [],
    description: '',
  };

  const event = { ...fallback, ...(raw ?? {}) };
  const layout = event.layout ?? fallback.layout;
  const dimensions = layout.dimensions ?? fallback.layout.dimensions;

  return {
    ...event,
    layout: {
      elements: Array.isArray(layout.elements) ? layout.elements : [],
      dimensions,
    },
  };
}

function renderEvent() {
  if (!state.event) return;

  selectors.eventName.textContent = state.event.name;
  selectors.eventSummary.textContent = buildSummary(state.event);
  selectors.eventDescription.textContent = state.event.description || 'Reserved seating for registered guests.';
  selectors.eventVenue.textContent = state.event.venue || 'Venue TBA';
  selectors.eventDate.textContent = state.event.date ? formatDate(state.event.date) : 'Date pending';

  const totals = computeSeatTotals(state.seats);
  selectors.statsAvailable.textContent = totals.open;
  selectors.statsReserved.textContent = totals.reserved;
  selectors.statsTotal.textContent = totals.total;

  if (!isSelectableSeat(state.seats.find((item) => item.id === state.selectedSeatId))) {
    state.selectedSeatId = null;
  }

  setupCanvas();
  renderSeatPanel();
  renderSeatPreview(state.seats.find((item) => item.id === state.selectedSeatId) ?? null);
  renderCheckoutState();
  scheduleCanvasRefresh();
}

function buildSummary(event) {
  const parts = [];
  if (event.venue) parts.push(event.venue);
  if (event.date) parts.push(formatDate(event.date));
  if (!parts.length) return 'Details coming soon.';
  return parts.join(' • ');
}

function computeSeatTotals(seats) {
  return seats.reduce(
    (acc, seat) => {
      const capacity = Math.max(1, Number(seat.capacity) || 1);
      acc.total += capacity;
      if (seat.status === 'reserved') acc.reserved += capacity;
      if (seat.status === 'open') acc.open += capacity;
      return acc;
    },
    { open: 0, reserved: 0, total: 0 }
  );
}

function setupCanvas() {
  if (!selectors.canvas) return;

  const context = selectors.canvas.getContext('2d');
  if (!context) {
    selectors.stageOverlay.textContent = 'Your browser does not support canvas rendering.';
    selectors.stageOverlay.classList.add('active');
    return;
  }
  state.canvasContext = context;
  window.addEventListener('resize', debounce(resizeCanvas, 150));
  scheduleCanvasRefresh();

  selectors.canvas.addEventListener('click', (event) => {
    const seat = pickSeatAt(event.offsetX, event.offsetY);
    if (!isSelectableSeat(seat)) {
      if (seat && seat.status !== 'open') {
        toast('That seat is not available. Choose an open seat.', { tone: 'error' });
      }
      clearSeatSelection();
      renderCanvas();
      return;
    }

    state.selectedSeatId = seat.id;
    renderSeatPanel();
    renderSeatPreview(seat);
    renderCheckoutState();
    renderCanvas();
  });
}

function resizeCanvas() {
  const rect = selectors.canvas?.getBoundingClientRect?.();
  if (!rect || !selectors.canvas) return;
  const pixelRatio = state.devicePixelRatio;
  selectors.canvas.width = rect.width * pixelRatio;
  selectors.canvas.height = rect.height * pixelRatio;
  state.scale = 1;
  renderCanvas();
}

function scheduleCanvasRefresh() {
  if (!selectors.canvas) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => resizeCanvas());
  });
}

function renderCanvas() {
  const { canvas, stageOverlay } = selectors;
  if (!canvas || !state.canvasContext || !state.event) return;

  const { width, height } = canvas;
  const context = state.canvasContext;
  context.save();
  context.clearRect(0, 0, width, height);

  const layout = state.event.layout;
  if (!layout || !layout.elements.length) {
    stageOverlay.textContent = 'No seating elements to display yet.';
    stageOverlay.classList.add('active');
    context.restore();
    return;
  }

  stageOverlay.classList.remove('active');

  const { dimensions } = layout;
  const scaleX = width / Math.max(dimensions.width, 1);
  const scaleY = height / Math.max(dimensions.height, 1);
  state.scale = Math.min(scaleX, scaleY);

  const offsetX = (width - dimensions.width * state.scale) / 2;
  const offsetY = (height - dimensions.height * state.scale) / 2;

  layout.elements.forEach((seat) => {
    drawSeat(context, seat, offsetX, offsetY);
  });

  context.restore();
}

function drawSeat(context, seat, offsetX, offsetY) {
  const palette = resolveSeatPalette(seat);
  const { position, dimensions } = seat;
  const x = offsetX + position.x * state.scale;
  const y = offsetY + position.y * state.scale;
  const width = dimensions.width * state.scale;
  const height = dimensions.height * state.scale;

  context.save();
  context.translate(x + width / 2, y + height / 2);
  context.rotate(((seat.rotation ?? 0) * Math.PI) / 180);
  context.translate(-(x + width / 2), -(y + height / 2));

  context.fillStyle = palette.fill;
  context.strokeStyle = palette.stroke;
  context.lineWidth = Math.max(1, 2 / state.scale);

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

  if (seat.id === state.selectedSeatId) {
    const pattern = ensureSelectionPattern();

    context.strokeStyle = '#22c55e';
    context.lineWidth = Math.max(1.5, 3 / state.scale);
    context.stroke();

    context.lineWidth = Math.max(4, 8 / state.scale);
    if (pattern) {
      context.strokeStyle = pattern;
      context.stroke();
    }
    context.lineWidth = Math.max(2, 4 / state.scale);
    context.strokeStyle = 'rgba(15, 23, 42, 0.25)';
    context.stroke();
  }

  if (seat.label) {
    context.fillStyle = palette.text;
    context.font = `${Math.max(10, Math.min(width, height) / 2.5)}px 'Inter', sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(seat.label, x + width / 2, y + height / 2);
  }

  context.restore();
}

function ensureSelectionPattern() {
  if (state.selectionPattern?.pattern) {
    return state.selectionPattern.pattern;
  }

  const patternCanvas = document.createElement('canvas');
  patternCanvas.width = 16;
  patternCanvas.height = 16;
  const patternContext = patternCanvas.getContext('2d');
  if (!patternContext) return null;

  patternContext.clearRect(0, 0, patternCanvas.width, patternCanvas.height);

  const gradient = patternContext.createLinearGradient(0, 0, 16, 16);
  gradient.addColorStop(0, 'rgba(34, 197, 94, 0.85)');
  gradient.addColorStop(1, 'rgba(34, 197, 94, 0.4)');

  patternContext.strokeStyle = gradient;
  patternContext.lineWidth = 4;
  patternContext.lineCap = 'round';

  const offsets = [-8, 0, 8, 16];
  offsets.forEach((offset) => {
    patternContext.beginPath();
    patternContext.moveTo(offset, 16);
    patternContext.lineTo(offset + 16, 0);
    patternContext.stroke();
  });

  const pattern = patternContext.createPattern(patternCanvas, 'repeat');
  if (!pattern) return null;

  state.selectionPattern = { pattern };
  return pattern;
}

function pickSeatAt(pointerX, pointerY) {
  if (!state.event) return null;
  const { canvas } = selectors;
  const rect = canvas.getBoundingClientRect();
  const scaleFactor = canvas.width / rect.width;
  const x = (pointerX * scaleFactor - (canvas.width - state.event.layout.dimensions.width * state.scale) / 2) / state.scale;
  const y = (pointerY * scaleFactor - (canvas.height - state.event.layout.dimensions.height * state.scale) / 2) / state.scale;

  return state.seats.find((seat) => {
    const { position, dimensions } = seat;
    return (
      x >= position.x &&
      x <= position.x + dimensions.width &&
      y >= position.y &&
      y <= position.y + dimensions.height
    );
  }) ?? null;
}

function resolveSeatPalette(seat) {
  const base = {
    fill: 'rgba(148, 163, 184, 0.18)',
    stroke: 'rgba(148, 163, 184, 0.55)',
    text: 'rgba(15, 23, 42, 0.78)',
  };

  const palettes = {
    open: {
      fill: 'rgba(34, 197, 94, 0.16)',
      stroke: 'rgba(34, 197, 94, 0.6)',
      text: 'rgba(15, 23, 42, 0.9)',
    },
    reserved: {
      fill: 'rgba(248, 113, 113, 0.16)',
      stroke: 'rgba(248, 113, 113, 0.6)',
      text: 'rgba(127, 29, 29, 0.9)',
    },
    occupied: {
      fill: 'rgba(249, 115, 22, 0.18)',
      stroke: 'rgba(249, 115, 22, 0.58)',
      text: 'rgba(120, 53, 15, 0.9)',
    },
    blocked: {
      fill: 'rgba(148, 163, 184, 0.15)',
      stroke: 'rgba(148, 163, 184, 0.5)',
      text: 'rgba(71, 85, 105, 0.9)',
    },
  };

  return palettes[seat.status] ?? base;
}

function clearSeatSelection() {
  state.selectedSeatId = null;
  renderSeatPanel();
  renderSeatPreview(null);
  renderCheckoutState();
}

function renderSeatPanel() {
  const panel = selectors.seatPanel;
  if (!panel) return;
  const seat = state.seats.find((item) => item.id === state.selectedSeatId);
  const selectableSeat = isSelectableSeat(seat) ? seat : null;

  if (!selectableSeat) {
    panel.innerHTML = `
      <h2>Select a seat</h2>
      <p class="muted">Tap an available seat on the map to view details and reserve.</p>
    `;
    return;
  }

  const statusLabel = selectableSeat.status === 'open' ? 'Available' : selectableSeat.status;
  panel.innerHTML = `
    <div class="seat-header">
      <div>
        <h2>${selectableSeat.label ?? 'Seat'}</h2>
        <p class="muted">${selectableSeat.type ? selectableSeat.type.toUpperCase() : 'General seating'}</p>
      </div>
      <span class="seat-status">${statusLabel}</span>
    </div>
    <div class="seat-meta">
      <span><strong>Capacity:</strong> ${Math.max(1, selectableSeat.capacity ?? 1)}</span>
      <span><strong>Price:</strong> ${formatSeatPrice(selectableSeat.price)}</span>
      <span><strong>Notes:</strong> ${selectableSeat.notes ?? 'No additional notes'}</span>
    </div>
  `;

  renderSeatPreview(selectableSeat);
}

function handleSeatHover(event) {
  if (!state.event || !state.canvasContext) return;
  const seat = pickSeatAt(event.offsetX, event.offsetY);
  if (!seat) {
    clearSeatPreview();
    return;
  }
  if (!isSelectableSeat(seat)) {
    clearSeatPreview();
    return;
  }
  if (seat.id !== state.selectedSeatId) {
    renderSeatPreview(seat);
  }
}

function renderSeatPreview(seat) {
  if (!selectors.seatPreview) return;
  const media = selectors.seatPreview.querySelector('.seat-preview__media');
  const image = selectors.seatPreviewImage;
  const meta = selectors.seatPreviewMeta;

  if (!media || !image || !meta) return;

  if (!isSelectableSeat(seat)) {
    media.dataset.state = 'empty';
    image.hidden = true;
    image.removeAttribute('src');
    meta.textContent = '';
    return;
  }

  const previewUrl = seat.previewImage || seat.photoUrl || seat.image || null;
  if (previewUrl) {
    image.hidden = false;
    image.src = previewUrl;
    media.dataset.state = 'image';
  } else {
    image.hidden = true;
    image.removeAttribute('src');
    media.dataset.state = 'empty';
  }

  meta.innerHTML = `
    <strong>${seat.label ?? 'Seat view'}</strong>
    <span>${seat.viewDescription ?? 'Experience the view before you book.'}</span>
  `;
}

function clearSeatPreview() {
  if (!selectors.seatPreview) return;
  const media = selectors.seatPreview.querySelector('.seat-preview__media');
  if (media) media.dataset.state = 'empty';
  if (selectors.seatPreviewImage) {
    selectors.seatPreviewImage.hidden = true;
    selectors.seatPreviewImage.removeAttribute('src');
  }
  if (selectors.seatPreviewMeta) {
    selectors.seatPreviewMeta.textContent = '';
  }
}

function renderCheckoutState() {
  const seat = state.seats.find((item) => item.id === state.selectedSeatId);
  const button = selectors.buySeatButton;
  if (!button) return;

  if (!seat) {
    button.disabled = true;
    button.textContent = 'Select a seat';
    selectors.checkoutNote.textContent = 'Choose an available seat to continue.';
    return;
  }

  if (!isSelectableSeat(seat)) {
    button.disabled = true;
    button.textContent = 'Seat unavailable';
    selectors.checkoutNote.textContent = 'Pick another open seat to reserve.';
    return;
  }

  if (!state.user) {
    button.disabled = false;
    button.textContent = 'Sign in to reserve';
    selectors.checkoutNote.textContent = 'Sign in with your email to complete the reservation.';
    return;
  }

  button.disabled = false;
  button.textContent = 'Reserve seat';
  selectors.checkoutNote.textContent = 'Fill in your name and email, then confirm your reservation.';
}

function renderAuthState() {
  const isAuthenticated = Boolean(state.user);
  if (selectors.loginButton) selectors.loginButton.style.display = isAuthenticated ? 'none' : '';
  if (selectors.logoutButton) selectors.logoutButton.style.display = isAuthenticated ? '' : 'none';
  selectors.buySeatButton?.classList.toggle('is-authenticated', isAuthenticated);
  if (isAuthenticated) {
    closeLoginOverlay();
    selectors.attendeeEmail.value = state.user.email ?? '';
    selectors.checkoutNote.textContent = 'Confirm the details and reserve your seat.';
  }
}

function openLoginOverlay() {
  selectors.loginOverlay?.setAttribute('aria-hidden', 'false');
}

function closeLoginOverlay() {
  selectors.loginOverlay?.setAttribute('aria-hidden', 'true');
}

async function handleGoogleLogin() {
  selectors.googleLoginButton?.classList.add('is-loading');
  selectors.loginError.textContent = '';
  try {
    await authClient.signInWithGoogle();
  } catch (error) {
    console.error('Customer login failed', error);
    selectors.loginError.textContent = error.message ?? 'We could not sign you in. Try again.';
  } finally {
    selectors.googleLoginButton?.classList.remove('is-loading');
  }
}

async function handleLogout() {
  try {
    await authClient.signOut();
    state.user = null;
    renderAuthState();
    toast('Signed out of guest session');
  } catch (error) {
    console.error('Customer logout failed', error);
    toast('Could not sign you out', { tone: 'error' });
  }
}

function handleSeatReservation() {
  const seat = state.seats.find((item) => item.id === state.selectedSeatId);
  if (!seat) {
    toast('Select a seat to reserve');
    return;
  }

  if (!state.user) {
    openLoginOverlay();
    return;
  }

  if (!isSelectableSeat(seat)) {
    toast('This seat is no longer available', { tone: 'error' });
    renderEvent();
    return;
  }

  const name = selectors.attendeeName.value.trim();
  const email = selectors.attendeeEmail.value.trim() || state.user.email;

  if (!name || !email) {
    toast('Enter your name and email before reserving', { tone: 'error' });
    return;
  }

  toast('Seat reserved! (mock)', { tone: 'success' });
}

function toggleLoading(active) {
  selectors.shell?.setAttribute('data-loading', String(active));
  selectors.loadingState?.classList.toggle('active', active);
  selectors.hero?.classList.toggle('hidden', active);
  selectors.content?.classList.toggle('hidden', active);
  selectors.about?.classList.toggle('hidden', active);
}

function renderError(message) {
  selectors.shell?.setAttribute('data-loading', 'false');
  selectors.loadingState?.classList.remove('active');
  selectors.errorState?.classList.add('active');
  selectors.errorState.textContent = message;
  selectors.hero?.classList.add('hidden');
  selectors.content?.classList.add('hidden');
  selectors.about?.classList.add('hidden');
}

function formatDate(value) {
  try {
    const formatter = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    return formatter.format(new Date(value));
  } catch (error) {
    return value ?? '';
  }
}

function formatSeatPrice(price) {
  if (!price && price !== 0) return 'Free';
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    });
    return formatter.format(price);
  } catch (error) {
    return `$${Number(price).toFixed(0)}`;
  }
}

function toast(message, options = {}) {
  const node = document.createElement('div');
  node.className = `toast ${options.tone ?? ''}`.trim();
  node.textContent = message;
  selectors.toastStack?.appendChild(node);
  requestAnimationFrame(() => node.classList.add('show'));
  setTimeout(() => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 200);
  }, options.duration ?? 2800);
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

