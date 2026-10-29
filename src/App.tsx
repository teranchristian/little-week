import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor,
  pointerWithin, rectIntersection, TouchSensor, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { defaultAnimateLayoutChanges, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  days, defaultFamily, familyIcon, familyStorageKey, findActivity, icons, moveActivity, newActivityId, newPersonId, parts, previousFamilyIcon, readFamily, readHideWords, readWeek,
  sampleWeekForFamily, storageKey, wordsStorageKey,
  type Activity, type ActivityDestination, type ActivityPosition, type Family, type PartId, type PersonId, type WeekPlan,
} from './planner';
import { findOpenMoji, openMojiUrl, searchOpenMoji, type OpenMojiIcon } from './openmoji';
import { imageFromFile, isCustomIcon, readCustomIcons, saveCustomIcons, validateIconFile, type CustomIcon, type IconScope } from './customIcons';
import { calendarSettingsKey, readCalendarSettings, visibleDays, type CalendarSettings, type VisibleDay, type WeekStart } from './calendarView';

interface EditTarget { day: number; part: PartId; index: number | null }
interface UndoMove { token: number; before: WeekPlan; message: string }
const FamilyContext = createContext<Family>(defaultFamily);
const CustomIconsContext = createContext<CustomIcon[]>([]);

function MemberEmoji({ emoji }: { emoji: string }) {
  const custom = useContext(CustomIconsContext).find(item => item.scope === 'family' && item.id === emoji);
  return custom ? <img className="member-picture" src={custom.image} alt="" /> : <span className="member-glyph">{emoji}</span>;
}

function Face({ id }: { id: PersonId }) {
  const members = useContext(FamilyContext).members;
  const person = members.find(member => member.id === id);
  if (!person) return null;
  return <span className={`face face-${members.indexOf(person) % 4}`} title={person.name} aria-label={person.name}><MemberEmoji emoji={person.emoji} /></span>;
}

function Participants({ who }: { who: PersonId[] }) {
  const members = useContext(FamilyContext).members;
  const everyone = members.length > 1 && members.every(person => who.includes(person.id));
  return <span className="people">
    {everyone ? <span className="all-people" title="Everyone" aria-label="Everyone"><IconPicture emoji={familyIcon} className="all-icon" /><span className="all-label">All</span></span> : who.map(id => <Face key={id} id={id} />)}
  </span>;
}

function Legend() {
  const members = useContext(FamilyContext).members;
  return <div className="legend"><span className="legendlabel">Who's who:</span>
    {members.map(person => <span className="legend-person" key={person.id}><Face id={person.id} /> {person.name}</span>)}
  </div>;
}

function slotId(day: number, part: PartId) { return `slot:${day}:${part}`; }

function ActivityContent({ activity }: { activity: Activity }) {
  return <>
    <IconPicture emoji={activity.icon} className="activity-emoji" />
    <span className="activity-details"><span className="activity-name">{activity.label}</span><Participants who={activity.who} /></span>
  </>;
}

function IconPicture({ emoji, className }: { emoji: string; className: string }) {
  const members = useContext(FamilyContext).members;
  const customIcons = useContext(CustomIconsContext);
  if (isCustomIcon(emoji)) {
    const custom = customIcons.find(item => item.id === emoji);
    return <span className={className} aria-hidden="true">{custom ? <img src={custom.image} alt="" /> : '🖼️'}</span>;
  }
  const isFamily = emoji === familyIcon || emoji === previousFamilyIcon;
  const columns = Math.ceil(Math.sqrt(members.length));
  if (isFamily) return <span className={`${className} family-picture`} aria-hidden="true" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(members.length / columns)}, minmax(0, 1fr))` }}>
    {members.map(person => <span key={person.id} className="family-picture-face" style={{ fontSize: `${Math.min(.42, .8 / columns)}em` }}><MemberEmoji emoji={person.emoji} /></span>)}
  </span>;
  const url = openMojiUrl(emoji);
  return <span className={className} aria-hidden="true">{url ? <img src={url} alt="" /> : emoji}</span>;
}

function ActivityCard({ day, part, index, activity, onEdit }: {
  day: number; part: PartId; index: number; activity: Activity; onEdit: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: activity.id,
    data: { type: 'activity', day, part, index },
    animateLayoutChanges: args => args.isSorting || args.wasDragging ? defaultAnimateLayoutChanges(args) : true,
  });
  return <button ref={setNodeRef} type="button" className={`activity ${isDragging ? 'is-dragging' : ''}`}
    style={{ transform: CSS.Transform.toString(transform), transition }}
    onClick={onEdit} title={`Edit or move ${activity.label}`} {...attributes} {...listeners}>
    <ActivityContent activity={activity} />
  </button>;
}

function DayPart({ day, part, activities, onEdit }: {
  day: number; part: typeof parts[number]; activities: Activity[]; onEdit: (target: EditTarget) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: slotId(day, part.id), data: { type: 'slot', day, part: part.id } });
  return <section ref={setNodeRef} className={`part ${part.id} ${isOver ? 'drop-target' : ''}`} aria-label={`${days[day]} ${part.name}`}>
    <div className="part-head"><span className="symbol" aria-hidden="true">{part.emoji}</span>{part.name}</div>
    <SortableContext items={activities.map(activity => activity.id)} strategy={verticalListSortingStrategy}>
      <div className="activities" data-count={activities.length}>
        {activities.map((activity, index) => <ActivityCard key={activity.id} day={day} part={part.id} index={index} activity={activity} onEdit={() => onEdit({ day, part: part.id, index })} />)}
      </div>
    </SortableContext>
    <button type="button" className="add" onClick={() => onEdit({ day, part: part.id, index: null })} title={`Add an activity to ${days[day]} ${part.name}`}>+ Add</button>
  </section>;
}

function Calendar({ week, displayedDays, onEdit, onCommit }: {
  week: WeekPlan; displayedDays: VisibleDay[]; onEdit: (target: EditTarget) => void;
  onCommit: (before: WeekPlan, after: WeekPlan, activityId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<Activity | null>(null);
  const [activeDay, setActiveDay] = useState(displayedDays[0].index);
  const dayNav = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<WeekPlan | null>(null);
  const originalWeek = useRef<WeekPlan | null>(null);
  const activeId = useRef<string | null>(null);
  const previewWeek = useRef<WeekPlan | null>(null);
  const previewKey = useRef<string | null>(null);
  const suppressDragClick = useRef(false);

  useEffect(() => {
    const updateActiveDay = () => {
      const navBottom = dayNav.current?.getBoundingClientRect().bottom ?? 0;
      let visibleDay = displayedDays[0].index;
      displayedDays.forEach(({ index }) => {
        const dayTop = document.getElementById(`day-${index}`)?.getBoundingClientRect().top;
        if (dayTop !== undefined && dayTop <= navBottom + 8) visibleDay = index;
      });
      setActiveDay(visibleDay);
    };
    updateActiveDay();
    window.addEventListener('scroll', updateActiveDay, { passive: true });
    window.addEventListener('resize', updateActiveDay);
    return () => {
      window.removeEventListener('scroll', updateActiveDay);
      window.removeEventListener('resize', updateActiveDay);
    };
  }, [displayedDays]);

  const collisionDetection: CollisionDetection = args => {
    const pointerHits = pointerWithin(args);
    const cardHits = pointerHits.filter(hit => args.droppableContainers.find(container => container.id === hit.id)?.data.current?.type === 'activity');
    return cardHits.length ? cardHits : pointerHits.length ? pointerHits : (args.pointerCoordinates ? rectIntersection(args) : closestCenter(args));
  };

  function dragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    const source = findActivity(week, id);
    if (!source) return;
    originalWeek.current = week;
    activeId.current = id;
    setDragging(week[source.day][source.part][source.index]);
  }

  function clearDrag() {
    suppressDragClick.current = true;
    window.setTimeout(() => { suppressDragClick.current = false; }, 0);
    setDragging(null);
    setPreview(null);
    previewWeek.current = null;
    previewKey.current = null;
    originalWeek.current = null;
    activeId.current = null;
  }

  function destinationFor(event: DragMoveEvent | DragOverEvent | DragEndEvent): ActivityDestination | undefined {
    const original = originalWeek.current;
    const id = activeId.current;
    const over = event.over;
    if (!original || !id || !over || String(over.id) === id) return;
    const source = findActivity(original, id);
    if (!source) return;
    const target = over.data.current as (
      | (ActivityPosition & { type: 'activity' })
      | ({ day: number; part: PartId; type: 'slot' })
    ) | undefined;
    if (!target) return;
    if (target.type === 'slot') return { day: target.day, part: target.part, index: null };
    const targetPosition = findActivity(original, String(over.id));
    if (!targetPosition) return;
    const draggedCenter = event.active.rect.current.translated
      ? event.active.rect.current.translated.top + event.active.rect.current.translated.height / 2
      : over.rect.top;
    const after = draggedCenter > over.rect.top + over.rect.height / 2;
    let index = targetPosition.index + Number(after);
    if (source.day === targetPosition.day && source.part === targetPosition.part && source.index < index) index--;
    return { day: targetPosition.day, part: targetPosition.part, index };
  }

  function updatePreview(event: DragMoveEvent | DragOverEvent) {
    const original = originalWeek.current;
    const id = activeId.current;
    const destination = destinationFor(event);
    if (!original || !id || !destination) return;
    const source = findActivity(original, id);
    if (!source) return;
    if (source.day === destination.day && source.part === destination.part) {
      if (previewWeek.current) {
        previewWeek.current = null;
        previewKey.current = null;
        setPreview(null);
      }
      return;
    }
    const key = `${destination.day}:${destination.part}:${destination.index ?? 'end'}`;
    if (previewKey.current === key) return;
    const next = moveActivity(original, source, destination);
    previewWeek.current = next;
    previewKey.current = key;
    setPreview(next);
  }

  function dragEnd(event: DragEndEvent) {
    const original = originalWeek.current;
    const id = activeId.current;
    const source = original && id ? findActivity(original, id) : undefined;
    const destination = destinationFor(event);
    if (original && source && id && event.over) {
      if (destination) onCommit(original, moveActivity(original, source, destination), id);
      else if (String(event.over.id) === id && previewWeek.current) onCommit(original, previewWeek.current, id);
    }
    clearDrag();
  }

  function edit(target: EditTarget) {
    if (!suppressDragClick.current) onEdit(target);
  }

  const visibleWeek = preview ?? week;
  const printRowWeights = parts.map(part => Math.max(0, ...displayedDays.map(({ index }) => visibleWeek[index][part.id].length)) + 0.4);
  const printRowTotal = printRowWeights.reduce((total, weight) => total + weight, 0);
  const printRowHeights = Object.fromEntries(parts.map((part, index) =>
    [`--print-${part.id}-height`, `${(183 * printRowWeights[index] / printRowTotal).toFixed(2)}mm`]
  ));
  return <section className="scroll" aria-label="Weekly family activities">
    <nav ref={dayNav} className="day-nav" aria-label="Jump to day">
      {displayedDays.map(({ index, label, date }) => <button key={index} type="button" className={activeDay === index ? 'active' : ''} aria-current={activeDay === index ? 'location' : undefined} onClick={() => document.getElementById(`day-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label}{date && <span className="nav-date">{date.getDate()}</span>}</button>)}
    </nav>
    <div className={`calendar ${displayedDays.length < 7 ? 'short-view' : ''}`} style={{ '--calendar-columns': displayedDays.length, ...printRowHeights } as CSSProperties}>
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={dragStart} onDragMove={updatePreview} onDragOver={updatePreview} onDragEnd={dragEnd} onDragCancel={clearDrag}>
      {displayedDays.map(({ index: dayIndex, label, date }) => <article className="day" id={`day-${dayIndex}`} key={dayIndex}>
        <div className="day-head"><span>{label}</span>{date && <span className="day-date">{date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}</div>
        {parts.map(part => <DayPart key={part.id} day={dayIndex} part={part} activities={visibleWeek[dayIndex][part.id]} onEdit={edit} />)}
      </article>)}
      {createPortal(<DragOverlay dropAnimation={null}>{dragging && <div className="activity drag-overlay"><ActivityContent activity={dragging} /></div>}</DragOverlay>, document.body)}
    </DndContext>
  </div></section>;
}

function CustomIconDialog({ scope, onSave, onClose }: {
  scope: IconScope; onSave: (icon: Omit<CustomIcon, 'id'>) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileRequest = useRef(0);
  const drag = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [source, setSource] = useState<{ file: File; url: string; width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1.4);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [name, setName] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const baseScale = source ? Math.max(240 / source.width, 240 / source.height) : 1;
  const imageWidth = source ? source.width * baseScale * zoom : 0;
  const imageHeight = source ? source.height * baseScale * zoom : 0;
  const limitX = Math.max(0, (imageWidth - 240) / 2);
  const limitY = Math.max(0, (imageHeight - 240) / 2);
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => () => { fileRequest.current++; }, []);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source.url); }, [source]);

  async function chooseFile(file: File) {
    const request = ++fileRequest.current;
    setBusy(true);
    setError('');
    let url: string | undefined;
    try {
      validateIconFile(file);
      url = URL.createObjectURL(file);
      const preview = new Image();
      preview.src = url;
      await preview.decode();
      if (request !== fileRequest.current) { URL.revokeObjectURL(url); return; }
      if (!preview.naturalWidth || !preview.naturalHeight) throw new Error('Could not read this image.');
      const baseName = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 25);
      setSource({ file, url, width: preview.naturalWidth, height: preview.naturalHeight });
      setZoom(1.4);
      setOffset({ x: 0, y: 0 });
      if (!name) setName(baseName);
      if (!tag) setTag(baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 25));
    } catch (cause) {
      if (url) URL.revokeObjectURL(url);
      setError(cause instanceof Error ? cause.message : 'Could not read this image.');
    } finally { if (request === fileRequest.current) setBusy(false); }
  }

  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    setOffset({
      x: clamp(drag.current.offsetX + event.clientX - drag.current.x, limitX),
      y: clamp(drag.current.offsetY + event.clientY - drag.current.y, limitY),
    });
  }

  async function save() {
    if (!source || !name.trim() || !tag.trim()) return;
    const request = fileRequest.current;
    setBusy(true);
    setError('');
    try {
      const image = await imageFromFile(source.file, { zoom, x: offset.x, y: offset.y });
      if (request !== fileRequest.current) return;
      onSave({ scope, image, name: name.trim(), tag: tag.trim() });
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this icon.'); }
    finally { if (request === fileRequest.current) setBusy(false); }
  }

  return createPortal(<dialog ref={dialog} className="custom-icon-dialog" aria-labelledby="customIconTitle" onClose={onClose}>
    <div className="modal-head"><h2 id="customIconTitle">Add {scope === 'family' ? 'family' : 'activity'} icon</h2><button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <label className="section-title" htmlFor="customIconFile">Image</label>
      <input id="customIconFile" className="mini-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const file = event.target.files?.[0]; if (file) void chooseFile(file); }} />
      <p className="hint">PNG, JPG, WebP, or GIF, up to 5 MB. GIFs use the first frame.</p>
      <div className={`custom-icon-preview ${source ? 'can-drag' : ''}`} role="img" aria-label="Square icon crop preview. Drag to move the image, or use arrow keys." tabIndex={source ? 0 : undefined}
        onPointerDown={event => { if (!source) return; drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={move}
        onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onKeyDown={event => { if (!source) return; const step = event.shiftKey ? 20 : 5; const delta = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key] as [number, number] | undefined; if (delta) { event.preventDefault(); setOffset(current => ({ x: clamp(current.x + delta[0], limitX), y: clamp(current.y + delta[1], limitY) })); } }}>
        {source ? <img src={source.url} alt="" draggable={false} style={{ width: imageWidth, height: imageHeight, transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px)` }} /> : <span>Preview</span>}
      </div>
      {source && <div className="custom-icon-zoom"><span className="hint">↔ Drag the image in the square to move it ↕</span><label htmlFor="customIconZoom">Size</label><input id="customIconZoom" type="range" min="1" max="3" step="0.05" value={zoom} onChange={event => { const nextZoom = Number(event.target.value); const nextWidth = source.width * baseScale * nextZoom; const nextHeight = source.height * baseScale * nextZoom; setZoom(nextZoom); setOffset(current => ({ x: clamp(current.x, (nextWidth - 240) / 2), y: clamp(current.y, (nextHeight - 240) / 2) })); }} /><output htmlFor="customIconZoom">{Math.round(zoom * 100)}%</output></div>}
      <label className="section-title" htmlFor="customIconName">Name</label>
      <input id="customIconName" className="mini-input" maxLength={25} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Ballet class" />
      <label className="section-title custom-icon-field" htmlFor="customIconTag">Tag name</label>
      <input id="customIconTag" className="mini-input" maxLength={25} value={tag} onChange={event => setTag(event.target.value)} placeholder="e.g. ballet" />
      <p className="hint">Search by name or tag in the {scope === 'family' ? 'family member' : 'activity'} picker.</p>
      {error && <p className="custom-icon-error" role="alert">{error}</p>}
    </div>
    <div className="modal-foot"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={busy || !source || !name.trim() || !tag.trim()} onClick={() => void save()}>Save icon</button></div>
  </dialog>, document.body);
}

function ActivityEditor({ target, activity, week, onSave, onDelete, onClose, onAddCustomIcon }: {
  target: EditTarget; activity: Activity; week: WeekPlan;
  onSave: (activity: Activity, destination: ActivityDestination) => void;
  onDelete: () => void; onClose: () => void;
  onAddCustomIcon: (icon: Omit<CustomIcon, 'id'>) => CustomIcon;
}) {
  const members = useContext(FamilyContext).members;
  const customIcons = useContext(CustomIconsContext);
  const dialog = useRef<HTMLDialogElement>(null);
  const iconSearch = useRef<HTMLInputElement>(null);
  const [icon, setIcon] = useState(activity.icon);
  const [label, setLabel] = useState(activity.label);
  const [iconQuery, setIconQuery] = useState('');
  const [addingCustomIcon, setAddingCustomIcon] = useState(false);
  const [who, setWho] = useState<PersonId[]>(activity.who);
  const [destinationDay, setDestinationDay] = useState(target.day);
  const [destinationPart, setDestinationPart] = useState<PartId>(target.part);
  const [position, setPosition] = useState(target.index ?? week[target.day][target.part].length);
  const availableActivities = (day: number, part: PartId) => week[day][part].filter((_, index) =>
    !(target.index !== null && target.day === day && target.part === part && target.index === index));
  const destinationActivities = availableActivities(destinationDay, destinationPart);
  const usedIcons = new Map<string, number>();
  for (const day of week) for (const part of parts) for (const item of day[part.id]) {
    usedIcons.set(item.icon, (usedIcons.get(item.icon) ?? 0) + 1);
  }
  const featuredEmojis = [
    ...[...usedIcons].sort((a, b) => b[1] - a[1]).map(([emoji]) => emoji),
    ...icons.map(([emoji]) => emoji),
  ];
  const featuredIcons = [...new Map(featuredEmojis.map(emoji => {
    const entry = findOpenMoji(emoji);
    return entry ? [entry.hexcode, entry] as const : null;
  }).filter((entry): entry is readonly [string, OpenMojiIcon] => entry !== null)).values()].slice(0, 9);
  const currentIcon = findOpenMoji(icon);
  if (!iconQuery.trim() && currentIcon && !featuredIcons.some(entry => entry.hexcode === currentIcon.hexcode)) {
    featuredIcons[featuredIcons.length - 1] = currentIcon;
  }
  const visibleIcons = iconQuery.trim() ? searchOpenMoji(iconQuery) : featuredIcons;
  const visibleCustomIcons = customIcons.filter(item => item.scope === 'activity' && (!iconQuery.trim() || `${item.name} ${item.tag}`.toLowerCase().includes(iconQuery.trim().toLowerCase())));

  useEffect(() => {
    dialog.current?.showModal();
    iconSearch.current?.focus();
    iconSearch.current?.select();
  }, []);

  function chooseIcon(nextIcon: string, nextLabel: string) {
    const previous = icons.find(([value]) => value === icon);
    const previousName = previous?.[1] ?? findOpenMoji(icon)?.name ?? customIcons.find(item => item.id === icon)?.name;
    if (!previousName || label === previousName) setLabel(nextLabel);
    setIcon(nextIcon);
  }

  function togglePerson(id: PersonId) {
    setWho(current => current.includes(id)
      ? current.filter(person => person !== id)
      : members.map(person => person.id).filter(person => current.includes(person) || person === id));
  }

  function save() {
    onSave(
      { id: activity.id, icon, label: label.trim() || icons.find(([value]) => value === icon)?.[1] || findOpenMoji(icon)?.name || customIcons.find(item => item.id === icon)?.name || 'Activity', who },
      { day: destinationDay, part: destinationPart, index: Math.min(position, destinationActivities.length) },
    );
  }

  return <dialog ref={dialog} aria-labelledby="editTitle" onClose={onClose} onClick={event => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className="modal-head"><h2 id="editTitle">{target.index === null ? 'Add' : 'Edit'} · {days[target.day]} {parts.find(part => part.id === target.part)?.name}</h2>
      <button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <div className="section-title">1. What are you doing?</div>
      <input ref={iconSearch} className="icon-search mini-input" type="search" aria-label="Search icons" placeholder="Search icons (e.g. happy, smile, park)" value={iconQuery} onChange={event => setIconQuery(event.target.value)} />
      <div className="custom-icon-upload">
        <button className="btn" type="button" onClick={() => setAddingCustomIcon(true)}>＋ Add custom icon</button>
      </div>
      <div className="emoji-picker" aria-label={iconQuery ? 'Matching icons' : 'Popular and calendar icons'}>
        {visibleCustomIcons.map(item => <button key={item.id} type="button" className={`choice ${icon === item.id ? 'selected' : ''}`} aria-label={item.name} aria-pressed={icon === item.id} onClick={() => chooseIcon(item.id, item.name)}>
          <IconPicture emoji={item.id} className="big" /><span>{item.name}</span><span className="custom-icon-tag">#{item.tag}</span>
        </button>)}
        {visibleIcons.map(entry => {
          const name = icons.find(([value]) => findOpenMoji(value)?.hexcode === entry.hexcode)?.[1] ?? entry.name;
          const selected = currentIcon?.hexcode === entry.hexcode;
          return <button key={entry.hexcode} type="button" className={`choice ${selected ? 'selected' : ''}`} aria-label={name} aria-pressed={selected} onClick={() => chooseIcon(entry.emoji, name)}>
            <IconPicture emoji={entry.emoji} className="big" /><span>{name}</span>
          </button>;
        })}
      </div>
      {visibleIcons.length === 0 && visibleCustomIcons.length === 0 && <div className="icon-empty">No icons found. Try another word.</div>}
      <label htmlFor="activityName" className="hint">Short label (optional for printing)</label>
      <input id="activityName" className="mini-input" maxLength={25} value={label} onChange={event => setLabel(event.target.value)} />
      <div className="section-title person-section-title person-section-heading">2. Who is doing it?
        <button className="select-all-link" type="button" aria-label="Select all family members" onClick={() => setWho(members.map(person => person.id))}>all</button>
      </div>
      <div className="person-grid">{members.map(person => <button key={person.id} type="button" className={`person-choice ${who.includes(person.id) ? 'selected' : ''}`} aria-pressed={who.includes(person.id)} onClick={() => togglePerson(person.id)}>
        <Face id={person.id} />{person.name}
      </button>)}</div>
      <div className="section-title destination-section-title">3. Where does it go?</div>
      <div className="destination-grid">
        <label className="hint">Day<select className="mini-input" aria-label="Day" value={destinationDay} onChange={event => {
          const day = Number(event.target.value);
          setDestinationDay(day);
          setPosition(availableActivities(day, destinationPart).length);
        }}>{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</select></label>
        <label className="hint">Time of day<select className="mini-input" aria-label="Time of day" value={destinationPart} onChange={event => {
          const part = event.target.value as PartId;
          setDestinationPart(part);
          setPosition(availableActivities(destinationDay, part).length);
        }}>{parts.map(part => <option key={part.id} value={part.id}>{part.name}</option>)}</select></label>
        <label className="hint destination-position">Position<select className="mini-input" aria-label="Position" value={position} onChange={event => setPosition(Number(event.target.value))}>
          <option value={0}>First</option>
          {destinationActivities.map((item, index) => <option key={index} value={index + 1}>After {item.label}</option>)}
        </select></label>
      </div>
    </div>
    <div className="modal-foot">
      {target.index === null ? <span /> : <button className="btn danger" type="button" onClick={onDelete}>Delete</button>}
      <div className="flex gap-2"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" onClick={save}>Save ✓</button></div>
    </div>
    {addingCustomIcon && <CustomIconDialog scope="activity" onClose={() => setAddingCustomIcon(false)} onSave={draft => {
      const added = onAddCustomIcon(draft);
      chooseIcon(added.id, added.name);
      setIconQuery('');
      setAddingCustomIcon(false);
    }} />}
  </dialog>;
}

function MoveToast({ message, onUndo, onDismiss }: {
  message: string; onUndo: () => void; onDismiss: () => void;
}) {
  return <div className="move-toast" role="status">
    <span className="move-toast-message" title={message}>{message}</span>
    <button className="move-toast-undo" type="button" onClick={onUndo}>Undo</button>
    <button className="move-toast-close" type="button" onClick={onDismiss} aria-label="Dismiss notification">×</button>
  </div>;
}

function FamilyEditor({ family, week, onSave, onClose, onAddCustomIcon }: {
  family: Family; week: WeekPlan; onSave: (family: Family) => void; onClose: () => void;
  onAddCustomIcon: (icon: Omit<CustomIcon, 'id'>) => CustomIcon;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const customIcons = useContext(CustomIconsContext);
  const [draft, setDraft] = useState<Family>(() => structuredClone(family));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [addingCustomIcon, setAddingCustomIcon] = useState(false);
  const selected = draft.members.find(member => member.id === selectedId);
  const usedBy = selected ? [...new Set(week.flatMap(day => parts.flatMap(part =>
    day[part.id].filter(activity => activity.icon.replaceAll('\uFE0F', '') === selected.emoji.replaceAll('\uFE0F', '')).map(activity => activity.label))))] : [];
  const suggested = ['👨', '👩', '👧', '👦', '👶', '🧑', '👴', '👵', '🐶', '🐱']
    .map(emoji => findOpenMoji(emoji)).filter((icon): icon is OpenMojiIcon => Boolean(icon));
  const choices = query.trim() ? searchOpenMoji(query) : suggested;
  const familyIcons = customIcons.filter(item => item.scope === 'family' && (!query.trim() || `${item.name} ${item.tag}`.toLowerCase().includes(query.trim().toLowerCase())));

  useEffect(() => { dialog.current?.showModal(); }, []);

  function updateMember(id: string, update: Partial<Family['members'][number]>) {
    setDraft(current => ({ ...current, members: current.members.map(member => member.id === id ? { ...member, ...update } : member) }));
  }

  function addMember() {
    const id = newPersonId();
    setDraft(current => ({ ...current, members: [...current.members, { id, name: '', emoji: '🧑' }] }));
    setSelectedId(id);
    setQuery('');
  }

  return <dialog ref={dialog} aria-labelledby="familyTitle" onClose={onClose}>
    <div className="modal-head"><h2 id="familyTitle">Customise family</h2><button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <label className="section-title" htmlFor="familyName">Planner name</label>
      <input id="familyName" className="mini-input" maxLength={40} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder={defaultFamily.name} />
      <div className="section-title person-section-title">Family members</div>
      <div className="family-members">{draft.members.map(member => <div className="family-member" key={member.id}>
        <button type="button" className={`member-emoji ${selectedId === member.id ? 'selected' : ''}`} onClick={() => { setSelectedId(member.id); setQuery(''); }} aria-label={`Change icon for ${member.name || 'new member'}`} aria-pressed={selectedId === member.id}><MemberEmoji emoji={member.emoji} /></button>
        <input className="mini-input" maxLength={25} aria-label="Member name" placeholder="Name" value={member.name} onChange={event => updateMember(member.id, { name: event.target.value })} />
        <button type="button" className="remove-member" aria-label={`Remove ${member.name || 'new member'}`} disabled={draft.members.length === 1} onClick={() => {
          setDraft(current => ({ ...current, members: current.members.filter(person => person.id !== member.id) }));
          if (selectedId === member.id) setSelectedId(null);
        }}>Remove</button>
      </div>)}</div>
      <button type="button" className="btn add-member" onClick={addMember}>+ Add member</button>
      {selected && <section className="member-picker" aria-label={`Choose emoji for ${selected.name || 'new member'}`}>
        <div className="section-title">Icon for {selected.name || 'new member'}</div>
        <input className="mini-input icon-search" type="search" aria-label="Search member emojis" placeholder="Search emojis (e.g. person, cat)" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="custom-icon-upload"><button className="btn" type="button" onClick={() => setAddingCustomIcon(true)}>＋ Add custom icon</button></div>
        <div className="emoji-picker">{familyIcons.map(item => <button type="button" key={item.id} className={`choice ${selected.emoji === item.id ? 'selected' : ''}`} aria-label={item.name} aria-pressed={selected.emoji === item.id} onClick={() => updateMember(selected.id, { emoji: item.id })}>
          <IconPicture emoji={item.id} className="big" /><span>{item.name}</span><span className="custom-icon-tag">#{item.tag}</span>
        </button>)}{choices.map(entry => <button type="button" key={entry.hexcode} className={`choice ${findOpenMoji(selected.emoji)?.hexcode === entry.hexcode ? 'selected' : ''}`} aria-label={entry.name} aria-pressed={findOpenMoji(selected.emoji)?.hexcode === entry.hexcode} onClick={() => updateMember(selected.id, { emoji: entry.emoji })}>
          <IconPicture emoji={entry.emoji} className="big" /><span>{entry.name}</span>
        </button>)}</div>
        {choices.length === 0 && familyIcons.length === 0 && <div className="icon-empty">No icons found. Try another word.</div>}
        {usedBy.length > 0 && <p className="emoji-warning" role="alert">⚠️ This emoji is also used for {usedBy.length === 1 ? `the “${usedBy[0]}” activity` : `${usedBy.length} activities (${usedBy.slice(0, 3).join(', ')}${usedBy.length > 3 ? ', …' : ''})`}. It may be confusing on the planner.</p>}
      </section>}
    </div>
    <div className="modal-foot"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={!draft.name.trim() || draft.members.some(member => !member.name.trim() || !member.emoji.trim())} onClick={() => onSave({ name: draft.name.trim(), members: draft.members.map(member => ({ ...member, name: member.name.trim() })) })}>Save family ✓</button></div>
    {addingCustomIcon && <CustomIconDialog scope="family" onClose={() => setAddingCustomIcon(false)} onSave={icon => {
      const added = onAddCustomIcon(icon);
      if (selectedId) updateMember(selectedId, { emoji: added.id });
      setQuery('');
      setAddingCustomIcon(false);
    }} />}
  </dialog>;
}

function CalendarSettingsDialog({ settings, onSave, onClose }: {
  settings: CalendarSettings; onSave: (settings: CalendarSettings) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState(settings);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const options: { value: WeekStart; title: string; description: string }[] = [
    { value: 'monday', title: 'Monday', description: 'Show Monday through Sunday' },
    { value: 'sunday', title: 'Sunday', description: 'Show Sunday through Saturday' },
    { value: 'today', title: 'Today', description: 'Start with today and look ahead' },
  ];
  return <dialog ref={dialog} className="calendar-settings-dialog" aria-labelledby="calendarSettingsTitle" onClose={onClose}>
    <div className="modal-head"><h2 id="calendarSettingsTitle">Calendar view</h2><button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <p className="settings-intro">Choose the first day to show. Your activities stay on their weekdays.</p>
      <fieldset className="week-start-options"><legend>Start the calendar on</legend>
        {options.map(option => <label key={option.value} className={`week-start-option ${draft.start === option.value ? 'selected' : ''}`}>
          <input type="radio" name="weekStart" value={option.value} checked={draft.start === option.value} onChange={() => setDraft(current => ({ ...current, start: option.value }))} />
          <span><strong>{option.title}</strong><small>{option.description}</small></span>
        </label>)}
      </fieldset>
      {draft.start === 'today' && <label className="days-to-show" htmlFor="daysToShow"><strong>Days to show</strong><span>Include today, then show up to 6 more days.</span>
        <select id="daysToShow" className="mini-input" value={draft.daysToShow} onChange={event => setDraft(current => ({ ...current, daysToShow: Number(event.target.value) }))}>
          {Array.from({ length: 7 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} {index === 0 ? 'day' : 'days'}</option>)}
        </select>
      </label>}
    </div>
    <div className="modal-foot"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" onClick={() => onSave(draft)}>Save view ✓</button></div>
  </dialog>;
}

export default function App() {
  const [family, setFamily] = useState<Family>(readFamily);
  const [week, setWeek] = useState<WeekPlan>(readWeek);
  const [customIcons, setCustomIcons] = useState<CustomIcon[]>(readCustomIcons);
  const [hideWords, setHideWords] = useState(readHideWords);
  const [calendarSettings, setCalendarSettings] = useState(readCalendarSettings);
  const [editingCalendar, setEditingCalendar] = useState(false);
  const [today, setToday] = useState(() => new Date());
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [editingFamily, setEditingFamily] = useState(false);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const toastToken = useRef(0);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(week)); } catch { /* Private browsing can block storage. */ } }, [week]);
  useEffect(() => { try { localStorage.setItem(familyStorageKey, JSON.stringify(family)); } catch { /* Private browsing can block storage. */ } }, [family]);
  useEffect(() => { try { localStorage.setItem(wordsStorageKey, String(hideWords)); } catch { /* Private browsing can block storage. */ } }, [hideWords]);
  useEffect(() => { try { localStorage.setItem(calendarSettingsKey, JSON.stringify(calendarSettings)); } catch { /* Private browsing can block storage. */ } }, [calendarSettings]);
  useEffect(() => {
    if (calendarSettings.start !== 'today') return;
    const timer = window.setInterval(() => {
      const now = new Date();
      setToday(current => current.toDateString() === now.toDateString() ? current : now);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [calendarSettings.start]);
  const displayedDays = useMemo(() => visibleDays(calendarSettings, today), [calendarSettings, today]);
  useEffect(() => {
    if (!undoMove) return;
    const timeout = window.setTimeout(() => setUndoMove(current => current?.token === undoMove.token ? null : current), 6000);
    return () => window.clearTimeout(timeout);
  }, [undoMove]);
  useEffect(() => {
    let hideTimeout: number | undefined;
    const updateBackToTop = () => {
      window.clearTimeout(hideTimeout);
      if (window.scrollY <= 160) {
        setShowBackToTop(false);
      } else {
        setShowBackToTop(true);
        hideTimeout = window.setTimeout(() => setShowBackToTop(false), 3500);
      }
    };
    window.addEventListener('scroll', updateBackToTop, { passive: true });
    return () => {
      window.removeEventListener('scroll', updateBackToTop);
      window.clearTimeout(hideTimeout);
    };
  }, []);

  function showMove(before: WeekPlan, after: WeekPlan, id: string) {
    const from = findActivity(before, id);
    const to = findActivity(after, id);
    if (!from || !to || (from.day === to.day && from.part === to.part && from.index === to.index)) {
      setUndoMove(null);
      return;
    }
    const activity = after[to.day][to.part][to.index];
    const part = parts.find(item => item.id === to.part)!;
    setUndoMove({ token: ++toastToken.current, before, message: `${activity.label} moved to ${days[to.day]} ${part.name}` });
  }

  function commitMove(before: WeekPlan, after: WeekPlan, id: string) {
    if (before === after) return;
    setWeek(after);
    showMove(before, after, id);
  }

  function saveActivity(activity: Activity, destination: ActivityDestination) {
    if (!target) return;
    const next = structuredClone(week);
    if (target.index !== null) next[target.day][target.part].splice(target.index, 1);
    next[destination.day][destination.part].splice(destination.index ?? next[destination.day][destination.part].length, 0, activity);
    setWeek(next);
    if (target.index !== null) showMove(week, next, activity.id);
    else setUndoMove(null);
    setTarget(null);
  }

  function addCustomIcon(icon: Omit<CustomIcon, 'id'>): CustomIcon {
    const added = { ...icon, id: `custom:${newActivityId()}` };
    try {
      saveCustomIcons([...customIcons, added]);
    } catch {
      throw new Error('Could not save this icon on this device. Try a smaller image or free up browser storage.');
    }
    setCustomIcons(current => [...current, added]);
    return added;
  }

  function deleteActivity() {
    if (!target || target.index === null) return;
    setUndoMove(null);
    setWeek(current => {
      const next = structuredClone(current);
      next[target.day][target.part].splice(target.index!, 1);
      return next;
    });
    setTarget(null);
  }

  function reset() {
    if (window.confirm('Restore the sample week? Your edits will be replaced.')) {
      setUndoMove(null);
      setWeek(sampleWeekForFamily(family));
    }
  }

  function saveFamily(nextFamily: Family) {
    const memberIds = new Set(nextFamily.members.map(member => member.id));
    setWeek(current => current.map(day => Object.fromEntries(parts.map(part => [part.id, day[part.id].map(activity =>
      ({ ...activity, who: activity.who.filter(id => memberIds.has(id)) }))])) as WeekPlan[number]));
    setFamily(nextFamily);
    setEditingFamily(false);
    setUndoMove(null);
  }

  const initialActivity = target && (target.index === null
    ? { id: newActivityId(), icon: '🛝', label: 'Playground', who: family.members[0] ? [family.members[0].id] : [] }
    : week[target.day][target.part][target.index]);

  return <FamilyContext.Provider value={family}><CustomIconsContext.Provider value={customIcons}><main className={`shell ${hideWords ? 'hide-words' : ''} ${showBackToTop ? 'with-back-to-top' : ''}`}>
    <header className="top">
      <div className="titleline"><img className="site-logo" src={`${import.meta.env.BASE_URL}logo/little-week.png`} alt="" /><div><h1>{family.name}</h1><p className="sub">The picture shows <strong>what</strong> we're doing. The little faces show <strong>who</strong> is doing it.</p></div></div>
      <div className="actions"><button className="btn" type="button" onClick={() => setEditingFamily(true)}>👨‍👩‍👧‍👦 Edit family</button><button className="btn" type="button" onClick={() => setEditingCalendar(true)}>📅 Calendar view: {calendarSettings.start === 'today' ? 'Today' : calendarSettings.start === 'sunday' ? 'Sunday' : 'Monday'}</button><button className="btn" type="button" onClick={() => setHideWords(value => !value)}>{hideWords ? '👀 Show words' : '🙈 Hide words'}</button><button className="btn" type="button" onClick={reset}>↺ Reset example</button><button className="btn primary" type="button" onClick={() => window.print()}>🖨️ Print A4</button></div>
    </header>
    <Legend />
    <div className="intro">Tap an activity to edit it. Drag it to another spot to move it (touch and hold on mobile). Tap <strong>+</strong> to add another activity. No exact times needed.</div>
    <Calendar week={week} displayedDays={displayedDays} onEdit={setTarget} onCommit={commitMove} />
    <p className="smallnote">Each time-of-day row fits its activities · Example activities only · Changes save on this device · A4 landscape print · Icons by <a href="https://openmoji.org/">OpenMoji</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)</p>
    {showBackToTop && <button className="back-to-top" type="button" aria-label="Back to top" title="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}><span aria-hidden="true">↑</span></button>}
    {target && initialActivity && <ActivityEditor target={target} activity={initialActivity} week={week} onSave={saveActivity} onDelete={deleteActivity} onClose={() => setTarget(null)} onAddCustomIcon={addCustomIcon} />}
    {editingFamily && <FamilyEditor family={family} week={week} onSave={saveFamily} onClose={() => setEditingFamily(false)} onAddCustomIcon={addCustomIcon} />}
    {editingCalendar && <CalendarSettingsDialog settings={calendarSettings} onSave={settings => { setToday(new Date()); setCalendarSettings(settings); setEditingCalendar(false); }} onClose={() => setEditingCalendar(false)} />}
    {undoMove && <MoveToast message={undoMove.message} onUndo={() => { setWeek(undoMove.before); setUndoMove(null); }} onDismiss={() => setUndoMove(null)} />}
  </main></CustomIconsContext.Provider></FamilyContext.Provider>;
}
