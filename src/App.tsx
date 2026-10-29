import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor,
  pointerWithin, rectIntersection, TouchSensor, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { defaultAnimateLayoutChanges, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  days, findActivity, icons, moveActivity, newActivityId, parts, people, personIds, readHideWords, readWeek,
  sampleWeek, storageKey, wordsStorageKey,
  type Activity, type ActivityDestination, type ActivityPosition, type PartId, type PersonId, type WeekPlan,
} from './planner';
import { findOpenMoji, openMojiUrl, searchOpenMoji, type OpenMojiIcon } from './openmoji';

interface EditTarget { day: number; part: PartId; index: number | null }
interface UndoMove { token: number; before: WeekPlan; message: string }

function Face({ id }: { id: PersonId }) {
  const person = people[id];
  return <span className={`face ${id}`} title={person.name} aria-label={person.name}>{person.emoji}</span>;
}

function Participants({ who }: { who: PersonId[] }) {
  const everyone = personIds.every(id => who.includes(id));
  return <span className="people">
    {everyone ? <span className="all-people" title="Everyone" aria-label="Everyone"><span className="all-icon" aria-hidden="true">👨‍👩‍👧‍👦</span><span className="all-label">All</span></span> : who.map(id => <Face key={id} id={id} />)}
  </span>;
}

function Legend() {
  return <div className="legend"><span className="legendlabel">Who's who:</span>
    {personIds.map(id => <span className="legend-person" key={id}><Face id={id} /> {people[id].name}</span>)}
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

function Calendar({ week, onEdit, onCommit }: {
  week: WeekPlan; onEdit: (target: EditTarget) => void;
  onCommit: (before: WeekPlan, after: WeekPlan, activityId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<Activity | null>(null);
  const [activeDay, setActiveDay] = useState(0);
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
      let visibleDay = 0;
      days.forEach((_, index) => {
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
  }, []);

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
  return <section className="scroll" aria-label="Weekly family activities">
    <nav ref={dayNav} className="day-nav" aria-label="Jump to day">
      {days.map((day, index) => <button key={day} type="button" className={activeDay === index ? 'active' : ''} aria-current={activeDay === index ? 'location' : undefined} onClick={() => document.getElementById(`day-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{day}</button>)}
    </nav>
    <div className="calendar">
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={dragStart} onDragMove={updatePreview} onDragOver={updatePreview} onDragEnd={dragEnd} onDragCancel={clearDrag}>
      {days.map((day, dayIndex) => <article className="day" id={`day-${dayIndex}`} key={day}>
        <div className="day-head">{day}</div>
        {parts.map(part => <DayPart key={part.id} day={dayIndex} part={part} activities={visibleWeek[dayIndex][part.id]} onEdit={edit} />)}
      </article>)}
      {createPortal(<DragOverlay dropAnimation={null}>{dragging && <div className="activity drag-overlay"><ActivityContent activity={dragging} /></div>}</DragOverlay>, document.body)}
    </DndContext>
  </div></section>;
}

function ActivityEditor({ target, activity, week, onSave, onDelete, onClose }: {
  target: EditTarget; activity: Activity; week: WeekPlan;
  onSave: (activity: Activity, destination: ActivityDestination) => void;
  onDelete: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const iconSearch = useRef<HTMLInputElement>(null);
  const [icon, setIcon] = useState(activity.icon);
  const [label, setLabel] = useState(activity.label);
  const [iconQuery, setIconQuery] = useState('');
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

  useEffect(() => {
    dialog.current?.showModal();
    iconSearch.current?.focus();
    iconSearch.current?.select();
  }, []);

  function chooseIcon(nextIcon: string, nextLabel: string) {
    const previous = icons.find(([value]) => value === icon);
    const previousName = previous?.[1] ?? findOpenMoji(icon)?.name;
    if (!previousName || label === previousName) setLabel(nextLabel);
    setIcon(nextIcon);
  }

  function togglePerson(id: PersonId) {
    setWho(current => current.includes(id)
      ? current.filter(person => person !== id)
      : personIds.filter(person => current.includes(person) || person === id));
  }

  function save() {
    onSave(
      { id: activity.id, icon, label: label.trim() || icons.find(([value]) => value === icon)?.[1] || findOpenMoji(icon)?.name || 'Activity', who },
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
      <div className="emoji-picker" aria-label={iconQuery ? 'Matching icons' : 'Popular and calendar icons'}>
        {visibleIcons.map(entry => {
          const name = icons.find(([value]) => findOpenMoji(value)?.hexcode === entry.hexcode)?.[1] ?? entry.name;
          const selected = currentIcon?.hexcode === entry.hexcode;
          return <button key={entry.hexcode} type="button" className={`choice ${selected ? 'selected' : ''}`} aria-label={name} aria-pressed={selected} onClick={() => chooseIcon(entry.emoji, name)}>
            <IconPicture emoji={entry.emoji} className="big" /><span>{name}</span>
          </button>;
        })}
      </div>
      {visibleIcons.length === 0 && <div className="icon-empty">No icons found. Try another word.</div>}
      <label htmlFor="activityName" className="hint">Short label (optional for printing)</label>
      <input id="activityName" className="mini-input" maxLength={25} value={label} onChange={event => setLabel(event.target.value)} />
      <div className="section-title person-section-title">2. Who is doing it?</div>
      <div className="person-grid">{personIds.map(id => <button key={id} type="button" className={`person-choice ${who.includes(id) ? 'selected' : ''}`} aria-pressed={who.includes(id)} onClick={() => togglePerson(id)}>
        <Face id={id} />{people[id].name}
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

export default function App() {
  const [week, setWeek] = useState<WeekPlan>(readWeek);
  const [hideWords, setHideWords] = useState(readHideWords);
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const toastToken = useRef(0);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(week)); } catch { /* Private browsing can block storage. */ } }, [week]);
  useEffect(() => { try { localStorage.setItem(wordsStorageKey, String(hideWords)); } catch { /* Private browsing can block storage. */ } }, [hideWords]);
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
      setWeek(structuredClone(sampleWeek));
    }
  }

  const initialActivity = target && (target.index === null
    ? { id: newActivityId(), icon: '🛝', label: 'Playground', who: ['ema'] as PersonId[] }
    : week[target.day][target.part][target.index]);

  return <main className={`shell ${hideWords ? 'hide-words' : ''} ${showBackToTop ? 'with-back-to-top' : ''}`}>
    <header className="top">
      <div className="titleline"><span className="rainbow" aria-hidden="true">🌈</span><div><h1>Our Week</h1><p className="sub">The picture shows <strong>what</strong> we're doing. The little faces show <strong>who</strong> is doing it.</p></div></div>
      <div className="actions"><button className="btn" type="button" onClick={() => setHideWords(value => !value)}>{hideWords ? '👀 Show words' : '🙈 Hide words'}</button><button className="btn" type="button" onClick={reset}>↺ Reset example</button><button className="btn primary" type="button" onClick={() => window.print()}>🖨️ Print A4</button></div>
    </header>
    <Legend />
    <div className="intro">Tap an activity to edit it. Drag it to another spot to move it (touch and hold on mobile). Tap <strong>+</strong> to add another activity. No exact times needed.</div>
    <Calendar week={week} onEdit={setTarget} onCommit={commitMove} />
    <p className="smallnote">Each time-of-day row fits its activities · Example activities only · Changes save on this device · A4 landscape print · Icons by <a href="https://openmoji.org/">OpenMoji</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)</p>
    {showBackToTop && <button className="back-to-top" type="button" aria-label="Back to top" title="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}><span aria-hidden="true">↑</span></button>}
    {target && initialActivity && <ActivityEditor target={target} activity={initialActivity} week={week} onSave={saveActivity} onDelete={deleteActivity} onClose={() => setTarget(null)} />}
    {undoMove && <MoveToast message={undoMove.message} onUndo={() => { setWeek(undoMove.before); setUndoMove(null); }} onDismiss={() => setUndoMove(null)} />}
  </main>;
}
