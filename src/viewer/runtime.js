/*
 * TapTrail viewer runtime.
 * Plain DOM JavaScript: no dependencies, no network access, no innerHTML.
 * The same file powers the in-app viewer AND the exported standalone HTML.
 * All guide text is inserted with textContent / setAttribute only.
 */
function mountViewer(root, data, options) {
  options = options || {};
  var steps = data.steps;
  var labels = data.labels;
  var total = steps.length;
  var index = 0; // index === total means "finished"
  var rtl = data.lang === 'ar';

  function fmt(template, vars) {
    return String(template).replace(/\{(\w+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
    });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function pct(n) {
    return Math.round(n * 100000) / 1000 + '%';
  }
  function placeBox(node, r) {
    node.style.left = pct(r.x);
    node.style.top = pct(r.y);
    node.style.width = pct(r.w);
    node.style.height = pct(r.h);
  }

  root.textContent = '';
  var view = el('div', 'tt-viewer');
  view.setAttribute('dir', rtl ? 'rtl' : 'ltr');
  view.setAttribute('lang', data.lang);
  view.setAttribute('data-theme', options.theme || 'auto');
  if (options.full) view.className += ' tt-full';
  if (options.compact) view.className += ' tt-compact';

  var main = el('div', 'tt-main');
  var headingTag = options.headingLevel === 2 ? 'h2' : 'h1';
  var header = el('header', 'tt-header');
  header.appendChild(el(headingTag, 'tt-title', data.title));
  if (data.description) header.appendChild(el('p', 'tt-description', data.description));
  main.appendChild(header);

  // Progress
  var progress = el('div', 'tt-progress');
  var progressText = el('p', 'tt-progress-text');
  var bar = el('div', 'tt-bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', labels.progress);
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(total));
  var segments = [];
  for (var i = 0; i < total; i++) {
    var seg = el('span', 'tt-seg');
    seg.setAttribute('aria-hidden', 'true');
    bar.appendChild(seg);
    segments.push(seg);
  }
  progress.appendChild(progressText);
  progress.appendChild(bar);
  main.appendChild(progress);

  // Announcements for screen readers
  var status = el('p', 'tt-sr-only');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  main.appendChild(status);

  // Step card
  var card = el('section', 'tt-card');
  card.setAttribute('aria-label', labels.progress);
  var instruction = el('p', 'tt-instruction');
  instruction.setAttribute('tabindex', '-1');
  instruction.setAttribute('dir', 'auto');
  var hint = el('p', 'tt-hint');
  var feedback = el('p', 'tt-feedback');
  feedback.setAttribute('role', 'status');
  var stageWrap = el('div', 'tt-stage-wrap');
  var stage = el('div', 'tt-stage');
  var img = el('img', 'tt-img');
  img.setAttribute('draggable', 'false');
  var hotspot = el('button', 'tt-hotspot');
  hotspot.setAttribute('type', 'button');
  stage.appendChild(img);
  stage.appendChild(hotspot);
  stageWrap.appendChild(stage);
  card.appendChild(instruction);
  card.appendChild(stageWrap);
  card.appendChild(hint);
  card.appendChild(feedback);
  main.appendChild(card);

  // Done card
  var done = el('section', 'tt-card tt-done');
  var doneMark = el('div', 'tt-done-mark', '✓');
  doneMark.setAttribute('aria-hidden', 'true');
  var doneTitle = el('h2', 'tt-done-title', labels.doneTitle);
  doneTitle.setAttribute('tabindex', '-1');
  done.appendChild(doneMark);
  done.appendChild(doneTitle);
  done.appendChild(el('p', 'tt-done-text', labels.doneText));
  main.appendChild(done);

  // Navigation
  var nav = el('nav', 'tt-nav');
  nav.setAttribute('aria-label', labels.progress);
  var back = el('button', 'tt-btn tt-btn-quiet', labels.back);
  back.setAttribute('type', 'button');
  var restart = el('button', 'tt-btn tt-btn-quiet', labels.restart);
  restart.setAttribute('type', 'button');
  var next = el('button', 'tt-btn tt-btn-primary');
  next.setAttribute('type', 'button');
  nav.appendChild(back);
  nav.appendChild(restart);
  nav.appendChild(next);
  main.appendChild(nav);

  var kbd = el('p', 'tt-kbd', labels.keyboardHint);
  main.appendChild(kbd);
  if (options.showFooter) {
    main.appendChild(el('p', 'tt-footer', labels.madeWith));
  }
  view.appendChild(main);

  // Print-friendly list of every step (hidden on screen)
  var print = el('div', 'tt-print');
  print.appendChild(el('h1', 'tt-print-title', data.title));
  if (data.description) print.appendChild(el('p', 'tt-print-desc', data.description));
  var printList = el('ol', 'tt-print-list');
  steps.forEach(function (s, n) {
    var li = el('li', 'tt-print-step');
    var text = el('p', 'tt-print-text', s.instruction);
    text.setAttribute('dir', 'auto');
    li.appendChild(text);
    var fig = el('div', 'tt-print-stage');
    var pimg = el('img', 'tt-print-img');
    pimg.setAttribute('alt', fmt(labels.screenshotAlt, { n: n + 1 }));
    pimg.setAttribute('src', s.image);
    fig.appendChild(pimg);
    if (s.hotspot) {
      var box = el('span', 'tt-print-hotspot');
      placeBox(box, s.hotspot);
      fig.appendChild(box);
    }
    li.appendChild(fig);
    printList.appendChild(li);
  });
  print.appendChild(printList);
  view.appendChild(print);

  root.appendChild(view);

  function setFeedback(text) {
    feedback.textContent = text || '';
  }

  function render(focusTarget) {
    var finished = index >= total;
    card.hidden = finished;
    done.hidden = !finished;
    hint.hidden = finished;
    setFeedback('');
    bar.setAttribute('aria-valuenow', String(Math.min(index, total)));
    for (var s = 0; s < segments.length; s++) {
      segments[s].className = 'tt-seg' + (s < index ? ' tt-seg-done' : s === index ? ' tt-seg-current' : '');
    }
    back.hidden = index === 0;
    restart.hidden = !finished;
    next.hidden = finished;

    if (finished) {
      progressText.textContent = fmt(labels.step, { n: total, total: total });
      bar.setAttribute('aria-valuetext', labels.doneTitle);
      status.textContent = labels.doneTitle;
      if (focusTarget) doneTitle.focus();
      return;
    }

    var step = steps[index];
    var text = fmt(labels.step, { n: index + 1, total: total });
    progressText.textContent = text;
    bar.setAttribute('aria-valuetext', text);
    instruction.textContent = step.instruction;
    img.setAttribute('src', step.image);
    img.setAttribute('alt', fmt(labels.screenshotAlt, { n: index + 1 }));
    img.setAttribute('width', String(step.width));
    img.setAttribute('height', String(step.height));
    stage.style.setProperty('--tt-ar', String(step.width / step.height));
    stage.style.maxWidth = step.width + 'px';
    if (step.hotspot) {
      hotspot.hidden = false;
      placeBox(hotspot, step.hotspot);
      hotspot.setAttribute('aria-label', fmt(labels.hotspotLabel, { instruction: step.instruction }));
      hint.textContent = labels.hotspotHint;
    } else {
      hotspot.hidden = true;
      hint.textContent = labels.noHotspotHint;
    }
    next.textContent = index === total - 1 ? labels.finish : labels.next;
    status.textContent = text + ': ' + step.instruction;
    if (focusTarget) instruction.focus();
  }

  function go(to, focus) {
    index = Math.max(0, Math.min(total, to));
    render(focus);
  }

  hotspot.addEventListener('click', function (ev) {
    ev.stopPropagation();
    go(index + 1, true);
  });
  stage.addEventListener('click', function () {
    if (index < total && steps[index].hotspot) setFeedback(labels.wrongClick);
  });
  next.addEventListener('click', function () {
    go(index + 1, false);
  });
  back.addEventListener('click', function () {
    go(index - 1, false);
  });
  restart.addEventListener('click', function () {
    go(0, true);
  });
  // In a standalone page the arrow keys work straight away; embedded viewers only react while focused inside.
  var keyTarget = options.full ? document : view;
  function onKeyDown(ev) {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.defaultPrevented) return;
    var tag = ev.target && ev.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var forward = rtl ? 'ArrowLeft' : 'ArrowRight';
    var backward = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (ev.key === forward && index < total) {
      ev.preventDefault();
      go(index + 1, false);
    } else if (ev.key === backward && index > 0) {
      ev.preventDefault();
      go(index - 1, false);
    }
  }
  keyTarget.addEventListener('keydown', onKeyDown);

  var handle = {
    go: go,
    destroy: function () {
      keyTarget.removeEventListener('keydown', onKeyDown);
      root.textContent = '';
    },
  };

  if (total === 0) {
    card.hidden = true;
    done.hidden = true;
    nav.hidden = true;
    progress.hidden = true;
    return handle;
  }

  render(false);
  return handle;
}

export { mountViewer };