import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  closestCenter, DndContext, DragOverlay, KeyboardSensor, MouseSensor,
  pointerWithin, rectIntersection, TouchSensor, useDroppable, useSensor, useSensors,
  type CollisionDetection, type DragEndEvent, type DragMoveEvent, type DragOverEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  calendarLimitError, maxActivitiesPerSection, maxPeoplePerActivity, sectionLayout, days, defaultFamily, defaultGroupIcons, familyIcon, familyStorageKey, findActivity, groupActivity, icons, memberRole, moveActivity, newActivityId, newPersonId, participantTokens, parts, previousFamilyIcon, readFamily, readWeek,
  printActivityWeight, sampleWeekForFamily, sortGroupedActivities, storageKey,
  type Activity, type ActivityDestination, type ActivityPosition, type Family, type FamilyGroup, type PartId, type PersonId, type WeekPlan,
} from './planner';
import { findOpenMoji, openMojiUrl, searchOpenMoji, type OpenMojiIcon } from './openmoji';
import { CSS } from '@dnd-kit/utilities';
import { fitImageScale, imageFromFile, isCustomIcon, readCustomIcons, saveCustomIcons, validateIconFile, type CustomIcon, type IconScope } from './customIcons';
import { calendarSettingsKey, readCalendarSettings, visibleDays, type CalendarSettings, type VisibleDay, type WeekStart } from './calendarView';
import { createBackup, parseBackup, saveBackup, type PlannerBackup } from './backup';

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
  const family = useContext(FamilyContext);
  const tokens = participantTokens(who, family.members);
  return <span className="people">
    {tokens.map(token => token.kind === 'person' ? <Face key={token.id} id={token.id} /> : <GroupFace key={token.group} group={token.group} />)}
  </span>;
}

function GroupPicture({ group, className, iconOverride }: { group: FamilyGroup; className: string; iconOverride?: string }) {
  const family = useContext(FamilyContext);
  const customIcons = useContext(CustomIconsContext);
  const icon = iconOverride ?? family.groupIcons?.[group] ?? 'auto';
  if (icon !== 'auto') {
    const custom = customIcons.find(item => item.id === icon && item.scope === 'family');
    const url = openMojiUrl(icon);
    return <span className={className} aria-hidden="true">{custom ? <img src={custom.image} alt="" /> : url ? <img src={url} alt="" /> : icon}</span>;
  }
  const members = family.members.filter(member => group === 'family' || (group === 'kids' ? memberRole(member) === 'child' : memberRole(member) !== 'child'));
  if (!members.length) return <span className={className} aria-hidden="true">{group === 'kids' ? '🧒' : '🧑'}</span>;
  const columns = Math.ceil(Math.sqrt(members.length));
  return <span className={`${className} family-picture`} aria-hidden="true" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${Math.ceil(members.length / columns)}, minmax(0, 1fr))` }}>
    {members.map(person => <span key={person.id} className="family-picture-face" style={{ fontSize: `${Math.min(.42, .8 / columns)}em` }}><MemberEmoji emoji={person.emoji} /></span>)}
  </span>;
}

function GroupFace({ group }: { group: FamilyGroup }) {
  const name = { family: 'Family', kids: 'Kids', parents: 'Parents' }[group];
  return <span className="face group-face" title={name} aria-label={name}><GroupPicture group={group} className="group-face-picture" /></span>;
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
  const customIcons = useContext(CustomIconsContext);
  if (isCustomIcon(emoji)) {
    const custom = customIcons.find(item => item.id === emoji);
    return <span className={className} aria-hidden="true">{custom ? <img src={custom.image} alt="" /> : '🖼️'}</span>;
  }
  if (emoji === familyIcon || emoji === previousFamilyIcon) return <GroupPicture group="family" className={className} />;
  const url = openMojiUrl(emoji);
  return <span className={className} aria-hidden="true">{url ? <img src={url} alt="" /> : emoji}</span>;
}

type DropPreview = { id: string; mode: 'before' | 'after' | 'group' };

function ActivityCard({ day, part, index, activity, onEdit, onDelete, dropPreview, dragging }: {
  day: number; part: PartId; index: number; activity: Activity; onEdit: () => void; onDelete: () => void; dropPreview: DropPreview | null; dragging: Activity | null;
}) {
  const { attributes, listeners, setNodeRef, isDragging, transform, transition } = useSortable({
    id: activity.id,
    data: { type: 'activity', day, part, index },
  });
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const button = card.querySelector<HTMLElement>('.activity-open');
    const icon = card.querySelector<HTMLElement>('.activity-emoji');
    const name = card.querySelector<HTMLElement>('.activity-name');
    const people = card.querySelector<HTMLElement>('.people');
    if (!button || !icon || !people) return;
    const update = () => {
      const faces = people.querySelectorAll<HTMLElement>('.face');
      const grouped = !!card.closest('.simultaneous-cards');
      const vertical = getComputedStyle(people).flexDirection === 'column';
      const aligned = getComputedStyle(button).flexDirection === 'column' && (grouped ? vertical : true);
      if (!faces.length || !aligned) {
        card.classList.remove('stack-top');
        return;
      }
      const faceHeight = faces[0].offsetHeight;
      const faceGap = parseFloat(getComputedStyle(people).rowGap) || 0;
      const remainingFaces = grouped
        ? (faces.length - 1) * (faceHeight + faceGap)
        : Math.max(0, ...Array.from(faces, face => face.offsetTop - faces[0].offsetTop));
      if (!grouped) {
        card.style.setProperty('--stack-first-face', `${faceHeight}px`);
        card.style.setProperty('--stack-extra-faces', `${remainingFaces}px`);
      }
      const buttonGap = parseFloat(getComputedStyle(button).rowGap) || 0;
      const details = card.querySelector<HTMLElement>('.activity-details');
      const detailsGap = name?.offsetHeight ? (parseFloat(getComputedStyle(details!).rowGap) || 0) : 0;
      // The centred layout has a spacer on each side of the icon and details.
      const baseline = icon.offsetHeight + (name?.offsetHeight || 0) + faceHeight + 3 * buttonGap + detailsGap;
      card.classList.toggle('stack-top', remainingFaces > (button.clientHeight - baseline) / 2);
    };
    const observer = new ResizeObserver(update);
    observer.observe(button);
    observer.observe(people);
    update();
    window.addEventListener('beforeprint', update);
    window.addEventListener('afterprint', update);
    return () => { observer.disconnect(); window.removeEventListener('beforeprint', update); window.removeEventListener('afterprint', update); };
  }, [activity.who, activity.icon, activity.label]);
  const peopleCount = participantTokens(activity.who, useContext(FamilyContext).members).length;
  return <div ref={node => { cardRef.current = node; setNodeRef(node); }} className={`activity ${isDragging ? 'is-dragging' : ''} ${dropPreview?.id === activity.id ? `drop-${dropPreview.mode}` : ''}`} style={{ '--people-count': Math.max(1, peopleCount) } as CSSProperties}>
    <button type="button" className="activity-open" style={{ transform: dropPreview && dropPreview.mode !== 'group' ? CSS.Transform.toString(transform) : undefined, transition }} onClick={onEdit}
      title={`Edit or move ${activity.label}`} {...attributes} {...listeners}>
      <ActivityContent activity={activity} />
    </button>
    {dragging && dragging.id !== activity.id && <GroupDropTarget id={activity.id} />}
    {dropPreview?.id === activity.id && dropPreview.mode !== 'group' && <span className={`drop-indicator ${dropPreview.mode}`} aria-hidden="true" />}
    <button type="button" className="activity-delete" onClick={onDelete}
      aria-label={`Delete ${activity.label || 'activity'}`} title={`Delete ${activity.label || 'activity'}`}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6m5 4v6m4-6v6" />
      </svg>
    </button>
  </div>;
}

function GroupDropTarget({ id }: { id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `group-target:${id}`, data: { type: 'group-target', activityId: id } });
  return <div ref={setNodeRef} className={`group-drop-target ${isOver ? 'is-over' : ''}`} aria-label="Group activities" />;
}

function GroupDropEdge({ day, part, id, edge }: { day: number; part: PartId; id: string; edge: 'before' | 'after' }) {
  const { setNodeRef, isOver } = useDroppable({ id: `group-edge:${day}:${part}:${id}:${edge}`, data: { type: 'group-edge', day, part, groupActivityId: id, edge } });
  return <div ref={setNodeRef} className={`group-drop-edge ${edge} ${isOver ? 'is-over' : ''}`}><span>Drop here to move {edge === 'before' ? 'above' : 'below'}</span></div>;
}

function DayPart({ day, part, activities, onEdit, onDelete, dropPreview, dragging }: {
  day: number; part: typeof parts[number]; activities: Activity[]; onEdit: (target: EditTarget) => void; onDelete: (activity: Activity) => void; dropPreview: DropPreview | null; dragging: Activity | null;
}) {
  const members = useContext(FamilyContext).members;
  const layout = sectionLayout(activities);
  const sectionFull = layout.slots >= maxActivitiesPerSection;
  const overLimit = layout.slots > maxActivitiesPerSection || layout.groupCount > 1 || layout.largestGroup > 2 || activities.some(item => participantTokens(item.who, members).length > maxPeoplePerActivity);
  const { setNodeRef, isOver } = useDroppable({ id: slotId(day, part.id), data: { type: 'slot', day, part: part.id } });
  return <section ref={setNodeRef} className={`part ${part.id} ${isOver ? 'drop-target' : ''}`} data-over-limit={overLimit ? 'true' : undefined} aria-label={`${days[day]} ${part.name}`}>
    <div className="part-head"><span className="symbol" aria-hidden="true">{part.emoji}</span>{part.name}</div>
    <SortableContext items={activities.map(activity => activity.id)} strategy={verticalListSortingStrategy}>
      <div className="activities" data-count={activities.length}>
        {activities.map((activity) => {
          const group = activity.simultaneousId ? activities.filter(item => item.simultaneousId === activity.simultaneousId) : [];
          if (group.length > 1 && group[0].id !== activity.id) return null;
          const card = (item: Activity) => {
            const itemIndex = activities.indexOf(item);
            return <ActivityCard key={item.id} day={day} part={part.id} index={itemIndex} activity={item} dropPreview={dropPreview} dragging={dragging} onEdit={() => onEdit({ day, part: part.id, index: itemIndex })} onDelete={() => onDelete(item)} />;
          };
          return group.length > 1 ? <div className={`simultaneous-group ${dragging ? 'group-dragging' : ''}`} key={activity.id}>{dragging && <GroupDropEdge day={day} part={part.id} id={activity.id} edge="before" />}<div className="simultaneous-cards">{sortGroupedActivities(group, members).map(card)}</div>{dragging && <GroupDropEdge day={day} part={part.id} id={activity.id} edge="after" />}</div> : card(activity);
        })}
      </div>
    </SortableContext>
    <button type="button" className="add" disabled={sectionFull} onClick={() => onEdit({ day, part: part.id, index: null })} title={sectionFull ? 'This section already has 2 activities or groups' : `Add an activity to ${days[day]} ${part.name}`}>{sectionFull ? 'Section full' : '+ Add'}</button>
  </section>;
}

function Calendar({ week, displayedDays, onEdit, onDelete, onCommit }: {
  week: WeekPlan; displayedDays: VisibleDay[]; onEdit: (target: EditTarget) => void; onDelete: (activity: Activity) => void;
  onCommit: (before: WeekPlan, after: WeekPlan, activityId: string) => void;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [dragging, setDragging] = useState<Activity | null>(null);
  const [dropHint, setDropHint] = useState('');
  const [dropPreview, setDropPreview] = useState<DropPreview | null>(null);
  const [activeDay, setActiveDay] = useState(displayedDays[0].index);
  const dayNav = useRef<HTMLElement>(null);
  const desktopDayHeaders = useRef<HTMLDivElement>(null);
  const originalWeek = useRef<WeekPlan | null>(null);
  const activeId = useRef<string | null>(null);
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
    const groupHits = pointerHits.filter(hit => args.droppableContainers.find(container => container.id === hit.id)?.data.current?.type === 'group-target');
    if (groupHits.length) return groupHits;
    const edgeHits = pointerHits.filter(hit => args.droppableContainers.find(container => container.id === hit.id)?.data.current?.type === 'group-edge');
    if (edgeHits.length) return edgeHits;
    const cardHits = pointerHits.filter(hit => hit.id !== args.active.id && args.droppableContainers.find(container => container.id === hit.id)?.data.current?.type === 'activity');
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
    setDropHint('');
    setDropPreview(null);
    originalWeek.current = null;
    activeId.current = null;
  }

  function pointerY(event: DragMoveEvent | DragOverEvent | DragEndEvent): number | undefined {
    const origin = event.activatorEvent;
    if ('clientY' in origin && typeof origin.clientY === 'number') return origin.clientY + event.delta.y;
    if ('touches' in origin && origin.touches instanceof TouchList && origin.touches.length) return origin.touches[0].clientY + event.delta.y;
    const rect = event.active.rect.current.translated;
    return rect ? rect.top + rect.height / 2 : undefined;
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
      | ({ day: number; part: PartId; type: 'group-edge'; groupActivityId: string; edge: 'before' | 'after' })
    ) | undefined;
    if (!target) return;
    if (target.type === 'slot') return { day: target.day, part: target.part, index: null };
    if (target.type === 'group-edge') {
      const items = original[target.day][target.part];
      const group = items.find(item => item.id === target.groupActivityId)?.simultaneousId;
      const indexes = items.map((item, index) => group && item.simultaneousId === group ? index : -1).filter(index => index >= 0);
      if (!indexes.length) return;
      let index = target.edge === 'before' ? Math.min(...indexes) : Math.max(...indexes) + 1;
      if (source.day === target.day && source.part === target.part && source.index < index) index--;
      return { day: target.day, part: target.part, index };
    }
    const targetPosition = findActivity(original, String(over.id));
    if (!targetPosition) return;
    const after = (pointerY(event) ?? over.rect.top) > over.rect.top + over.rect.height / 2;
    const targetActivity = original[targetPosition.day][targetPosition.part][targetPosition.index];
    const items = original[targetPosition.day][targetPosition.part];
    const groupIndexes = targetActivity.simultaneousId ? items.map((item, index) => item.simultaneousId === targetActivity.simultaneousId ? index : -1).filter(index => index >= 0) : [targetPosition.index];
    let index = after ? Math.max(...groupIndexes) + 1 : Math.min(...groupIndexes);
    if (source.day === targetPosition.day && source.part === targetPosition.part && source.index < index) index--;
    return { day: targetPosition.day, part: targetPosition.part, index };
  }

  function groupTarget(event: DragMoveEvent | DragOverEvent | DragEndEvent): string | undefined {
    const target = event.over?.data.current;
    return target?.type === 'group-target' && target.activityId !== activeId.current ? target.activityId as string : undefined;
  }

  function updatePreview(event: DragMoveEvent | DragOverEvent) {
    const original = originalWeek.current;
    const id = activeId.current;
    const destination = destinationFor(event);
    const group = groupTarget(event);
    setDropHint(group ? 'Drop to do these at the same time' : destination ? 'Drop to move the activity here' : '');
    if (group) { setDropPreview({ id: group, mode: 'group' }); return; }
    if (!original || !id || !destination || !event.over) { setDropPreview(null); return; }
    if (event.over.data.current?.type === 'activity') {
      const mode = group ? 'group' : (pointerY(event) ?? event.over.rect.top) < event.over.rect.top + event.over.rect.height / 2 ? 'before' : 'after';
      setDropPreview({ id: String(event.over.id), mode });
    } else setDropPreview(null);

  }

  function dragEnd(event: DragEndEvent) {
    const original = originalWeek.current;
    const id = activeId.current;
    const source = original && id ? findActivity(original, id) : undefined;
    const destination = destinationFor(event);
    if (original && source && id && event.over) {
      const group = groupTarget(event);
      if (group) onCommit(original, groupActivity(original, id, group), id);
      else if (destination) onCommit(original, moveActivity(original, source, destination), id);
    }
    clearDrag();
  }

  function edit(target: EditTarget) {
    if (!suppressDragClick.current) onEdit(target);
  }

  useEffect(() => {
    // Keep the printed calendar full width and fit its content into one page.
    function fitPrint() {
      const calendar = document.querySelector<HTMLElement>('.calendar');
      const scroll = calendar?.closest<HTMLElement>('.scroll');
      if (!calendar || !scroll) return;
      // Chrome's beforeprint event can run before print media styles take effect.
      // Apply those media rules temporarily so measurements match the PDF.
      const mediaRules: [MediaList, string][] = [];
      for (const sheet of Array.from(document.styleSheets)) {
        for (const rule of Array.from(sheet.cssRules)) {
          if (!(rule instanceof CSSMediaRule)) continue;
          mediaRules.push([rule.media, rule.media.mediaText]);
          rule.media.mediaText = rule.media.mediaText.includes('print') ? 'all' : 'not all';
        }
      }
      try {
        scroll.style.removeProperty('--print-scale');
        const availableHeight = 198 * 96 / 25.4; // A4 height minus the page padding.
        if (calendar.getBoundingClientRect().height <= availableHeight) return;
        // Wider columns at smaller scales can reduce avatar wrapping, so remeasure.
        let lower = 0.01;
        let upper = 1;
        for (let i = 0; i < 14; i++) {
          const scale = (lower + upper) / 2;
          scroll.style.setProperty('--print-scale', String(scale));
          if (calendar.getBoundingClientRect().height <= availableHeight) lower = scale;
          else upper = scale;
        }
        scroll.style.setProperty('--print-scale', String(lower));
      } finally {
        for (const [media, original] of mediaRules) media.mediaText = original;
      }
    }
    function resetPrint() {
      document.querySelector<HTMLElement>('.scroll')?.style.removeProperty('--print-scale');
    }
    window.addEventListener('beforeprint', fitPrint);
    window.addEventListener('afterprint', resetPrint);
    return () => {
      window.removeEventListener('beforeprint', fitPrint);
      window.removeEventListener('afterprint', resetPrint);
    };
  }, []);

  useEffect(() => {
    const calendar = document.querySelector<HTMLElement>('.fullscreen-calendar .calendar');
    const scroll = calendar?.closest<HTMLElement>('.scroll');
    if (!calendar || !scroll) return;
    const fit = () => {
      calendar.style.removeProperty('--fullscreen-scale');
      if (calendar.getBoundingClientRect().height <= scroll.clientHeight) return;
      let lower = 0.01;
      let upper = 1;
      for (let i = 0; i < 14; i++) {
        const scale = (lower + upper) / 2;
        calendar.style.setProperty('--fullscreen-scale', String(scale));
        if (calendar.getBoundingClientRect().height <= scroll.clientHeight) lower = scale;
        else upper = scale;
      }
      calendar.style.setProperty('--fullscreen-scale', String(lower));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(scroll);
    fit();
    return () => {
      observer.disconnect();
      calendar.style.removeProperty('--fullscreen-scale');
    };
  });

  const visibleWeek = week;
  const members = useContext(FamilyContext).members;
  const printRowWeights = parts.map(part => Math.max(0, ...displayedDays.map(({ index }) => printActivityWeight(visibleWeek[index][part.id], members))) + 0.4);
  const printRowTotal = printRowWeights.reduce((total, weight) => total + weight, 0);
  const printRowHeights = Object.fromEntries(parts.map((part, index) =>
    [`--print-${part.id}-height`, `${(183 * printRowWeights[index] / printRowTotal).toFixed(2)}mm`]
  ));
  const fullscreenRowWeights = Object.fromEntries(parts.map(part =>
    [`--fullscreen-${part.id}-weight`, `${Math.max(0, ...displayedDays.map(({ index: day }) => sectionLayout(visibleWeek[day][part.id]).slots)) + 0.4}fr`]
  ));
  return <>
    <div className="desktop-day-bar" aria-hidden="true">
      <div ref={desktopDayHeaders} className="desktop-day-bar-inner" style={{ '--calendar-columns': displayedDays.length } as CSSProperties}>
        <div className="day-part-corner" />
        {displayedDays.map(({ index, label, date }) => <div className="day-head" key={index}><span>{label}</span>{date && <span className="day-date">{date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}</div>)}
      </div>
    </div>
    <section className="scroll" aria-label="Weekly family activities" onScroll={event => {
      if (desktopDayHeaders.current) desktopDayHeaders.current.style.transform = `translateX(${-event.currentTarget.scrollLeft}px)`;
    }}>
    <nav ref={dayNav} className="day-nav" aria-label="Jump to day">
      {displayedDays.map(({ index, label, date }) => <button key={index} type="button" className={activeDay === index ? 'active' : ''} aria-current={activeDay === index ? 'location' : undefined} onClick={() => document.getElementById(`day-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{label}{date && <span className="nav-date">{date.getDate()}</span>}</button>)}
    </nav>
    <div className={`calendar ${displayedDays.length < 7 ? 'short-view' : ''}`} style={{ '--calendar-columns': displayedDays.length, ...printRowHeights, ...fullscreenRowWeights } as CSSProperties}>
    <div className="calendar-corner" aria-hidden="true" />
    {parts.map(part => <div className={`day-part-label ${part.id}`} key={part.id} aria-hidden="true"><span className="day-part-icon">{part.emoji}</span><span>{part.name}</span></div>)}
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={dragStart} onDragMove={updatePreview} onDragOver={updatePreview} onDragEnd={dragEnd} onDragCancel={clearDrag}>
      {displayedDays.map(({ index: dayIndex, label, date }) => <article className="day" id={`day-${dayIndex}`} key={dayIndex}>
        <div className="day-head"><span>{label}</span>{date && <span className="day-date">{date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>}</div>
        {parts.map(part => <DayPart key={part.id} day={dayIndex} part={part} activities={visibleWeek[dayIndex][part.id]} dropPreview={dropPreview} dragging={dragging} onEdit={edit} onDelete={onDelete} />)}
      </article>)}
      {dragging && dropHint && <div className="drag-hint" role="status">{dropHint}</div>}
      {createPortal(<DragOverlay dropAnimation={null}>{dragging && <div className="activity drag-overlay"><ActivityContent activity={dragging} /></div>}</DragOverlay>, document.body)}
    </DndContext>
  </div></section></>;
}

function CustomIconDialog({ scope, existing, onSave, onClose }: {
  scope: IconScope; existing?: CustomIcon; onSave: (icon: Omit<CustomIcon, 'id'>) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fileRequest = useRef(0);
  const drag = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [source, setSource] = useState<{ file: File | null; url: string; width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [name, setName] = useState(existing?.name ?? '');
  const [tag, setTag] = useState(existing?.tag ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const baseScale = source ? fitImageScale(source.width, source.height, 240) : 1;
  const imageWidth = source ? source.width * baseScale * zoom : 0;
  const imageHeight = source ? source.height * baseScale * zoom : 0;
  const limitX = Math.max(0, (imageWidth - 240) / 2);
  const limitY = Math.max(0, (imageHeight - 240) / 2);
  const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => () => { fileRequest.current++; }, []);
  useEffect(() => {
    if (!existing) return;
    const request = fileRequest.current;
    const preview = new Image();
    preview.src = existing.image;
    void preview.decode().then(() => {
      if (request === fileRequest.current && preview.naturalWidth && preview.naturalHeight) {
        setSource({ file: null, url: existing.image, width: preview.naturalWidth, height: preview.naturalHeight });
      }
    }).catch(() => setError('Could not edit this image. You can still replace it.'));
  }, [existing]);
  useEffect(() => () => { if (source?.file) URL.revokeObjectURL(source.url); }, [source]);

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
      setZoom(1);
      setRotation(0);
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
    if ((!source && !existing) || !name.trim() || !tag.trim()) return;
    const request = fileRequest.current;
    setBusy(true);
    setError('');
    try {
      const image = source && (source.file || zoom !== 1 || rotation !== 0 || offset.x !== 0 || offset.y !== 0)
        ? await imageFromFile(source.file ?? source.url, { zoom, x: offset.x, y: offset.y, rotation })
        : existing!.image;
      if (request !== fileRequest.current) return;
      onSave({ scope, image, name: name.trim(), tag: tag.trim() });
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this icon.'); }
    finally { if (request === fileRequest.current) setBusy(false); }
  }

  return createPortal(<dialog ref={dialog} className="custom-icon-dialog" aria-labelledby="customIconTitle" onClose={onClose}>
    <div className="modal-head"><h2 id="customIconTitle">{existing ? 'Edit' : 'Add'} {scope === 'family' ? 'person' : 'activity'} icon</h2><button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <label className="section-title" htmlFor="customIconFile">{existing ? 'Replace image (optional)' : 'Image'}</label>
      <input id="customIconFile" className="mini-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const file = event.target.files?.[0]; if (file) void chooseFile(file); }} />
      <p className="hint">PNG, JPG, WebP, or GIF, up to 5 MB. GIFs use the first frame.</p>
      <div className={`custom-icon-preview ${source ? 'can-drag' : ''} ${existing && !source ? 'existing-icon' : ''}`} role="img" aria-label="Square icon crop preview. Drag to move the image, or use arrow keys." tabIndex={source ? 0 : undefined}
        onPointerDown={event => { if (!source) return; drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={move}
        onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) drag.current = null; }}
        onKeyDown={event => { if (!source) return; const step = event.shiftKey ? 20 : 5; const delta = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[event.key] as [number, number] | undefined; if (delta) { event.preventDefault(); setOffset(current => ({ x: clamp(current.x + delta[0], limitX), y: clamp(current.y + delta[1], limitY) })); } }}>
        {source ? <img src={source.url} alt="" draggable={false} style={{ width: imageWidth, height: imageHeight, transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg)` }} /> : existing ? <img src={existing.image} alt="" /> : <span>Preview</span>}
      </div>
      {source && <div className="custom-icon-controls"><span className="hint">↔ Drag the image in the square to move it ↕</span><label htmlFor="customIconZoom">Size</label><input id="customIconZoom" type="range" min="1" max="3" step="0.05" value={zoom} onChange={event => { const nextZoom = Number(event.target.value); const nextWidth = source.width * baseScale * nextZoom; const nextHeight = source.height * baseScale * nextZoom; setZoom(nextZoom); setOffset(current => ({ x: clamp(current.x, (nextWidth - 240) / 2), y: clamp(current.y, (nextHeight - 240) / 2) })); }} /><output htmlFor="customIconZoom">{Math.round(zoom * 100)}%</output><label htmlFor="customIconRotation">Tilt</label><input id="customIconRotation" type="range" min="-30" max="30" step="1" value={rotation} onChange={event => setRotation(Number(event.target.value))} /><output htmlFor="customIconRotation">{rotation}°</output></div>}
      <label className="section-title" htmlFor="customIconName">Name</label>
      <input id="customIconName" className="mini-input" maxLength={25} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Ballet class" />
      <label className="section-title custom-icon-field" htmlFor="customIconTag">Tag name</label>
      <input id="customIconTag" className="mini-input" maxLength={25} aria-describedby="customIconTagHint" value={tag} onChange={event => setTag(event.target.value)} placeholder="e.g. ballet" />
      <p id="customIconTagHint" className="hint">Add a word or short phrase to help find this icon in the {scope === 'family' ? 'family member' : 'activity'} picker. Multiple words are searched as one phrase.</p>
      {error && <p className="custom-icon-error" role="alert">{error}</p>}
    </div>
    <div className="modal-foot"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={busy || (!source && !existing) || !name.trim() || !tag.trim()} onClick={() => void save()}>Save icon</button></div>
  </dialog>, document.body);
}

function CustomIconsManager({ icons, onAdd, onUpdate, onDelete, onClose }: {
  icons: CustomIcon[];
  onAdd: (icon: Omit<CustomIcon, 'id'>) => void;
  onUpdate: (icon: CustomIcon) => void;
  onDelete: (icon: CustomIcon) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [scope, setScope] = useState<IconScope>('family');
  const [editing, setEditing] = useState<CustomIcon | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const shown = icons.filter(icon => icon.scope === scope);

  useEffect(() => { dialog.current?.showModal(); }, []);

  return <dialog ref={dialog} className="custom-icons-manager" aria-labelledby="customIconsTitle" onClose={onClose}>
    <div className="modal-head"><h2 id="customIconsTitle">Custom icons</h2><button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <p className="settings-intro">Add or edit picture icons for people and activities. Each group has its own icons.</p>
      <div className="custom-icon-tabs" role="group" aria-label="Icon type">
        <button type="button" aria-pressed={scope === 'family'} className={`btn ${scope === 'family' ? 'selected' : ''}`} onClick={() => setScope('family')}>People</button>
        <button type="button" aria-pressed={scope === 'activity'} className={`btn ${scope === 'activity' ? 'selected' : ''}`} onClick={() => setScope('activity')}>Activities</button>
      </div>
      <div className="custom-icon-list">
        {shown.length ? shown.map(icon => <div className="custom-icon-row" key={icon.id}>
          <img src={icon.image} alt="" />
          <span className="custom-icon-details"><strong>{icon.name}</strong><small>#{icon.tag}</small></span>
          <button className="btn" type="button" onClick={() => setEditing(icon)} aria-label={`Edit ${icon.name}`}>Edit</button>
          <button className="btn danger" type="button" onClick={() => {
            setError('');
            try { onDelete(icon); }
            catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete this icon.'); }
          }} aria-label={`Delete ${icon.name}`}>Delete</button>
        </div>) : <p className="icon-empty">No custom {scope === 'family' ? 'people' : 'activity'} icons yet.</p>}
      </div>
      {error && <p className="custom-icon-error" role="alert">{error}</p>}
    </div>
    <div className="modal-foot"><button className="btn" type="button" onClick={onClose}>Close</button><button className="btn primary" type="button" onClick={() => setAdding(true)}>＋ Add {scope === 'family' ? 'person' : 'activity'} icon</button></div>
    {(adding || editing) && <CustomIconDialog key={editing?.id ?? scope} scope={editing?.scope ?? scope} existing={editing ?? undefined} onClose={() => { setAdding(false); setEditing(null); }} onSave={draft => {
      if (editing) onUpdate({ ...editing, ...draft });
      else onAdd(draft);
      setAdding(false);
      setEditing(null);
    }} />}
  </dialog>;
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
  const [parallelWith, setParallelWith] = useState(() => activity.simultaneousId ? week[target.day][target.part].find(item => item.id !== activity.id && item.simultaneousId === activity.simultaneousId)?.id ?? '' : '');
  const [position, setPosition] = useState(target.index ?? week[target.day][target.part].length);
  const availableActivities = (day: number, part: PartId) => week[day][part].filter((_, index) =>
    !(target.index !== null && target.day === day && target.part === part && target.index === index));
  const destinationActivities = availableActivities(destinationDay, destinationPart);
  const parallelOptions = destinationActivities.reduce<Activity[][]>((groups, item) => {
    const group = item.simultaneousId && groups.find(items => items[0].simultaneousId === item.simultaneousId);
    if (group) group.push(item);
    else groups.push([item]);
    return groups;
  }, []);
  const selectedParallel = parallelOptions.find(group => group.some(item => item.id === parallelWith))?.[0].id ?? '';
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
    setWho(current => {
      const next = current.includes(id) ? current.filter(person => person !== id) : members.map(person => person.id).filter(person => current.includes(person) || person === id);
      return participantTokens(next, members).length <= maxPeoplePerActivity ? next : current;
    });
  }

  function toggleGroup(group: FamilyGroup) {
    const ids = members.filter(member => group === 'family' || (group === 'kids' ? memberRole(member) === 'child' : memberRole(member) !== 'child')).map(member => member.id);
    if (!ids.length) return;
    setWho(current => {
      const selected = ids.every(id => current.includes(id));
      const next = selected ? current.filter(id => !ids.includes(id)) : members.map(member => member.id).filter(id => current.includes(id) || ids.includes(id));
      return participantTokens(next, members).length <= maxPeoplePerActivity ? next : current;
    });
  }

  function save() {
    const companion = destinationActivities.find(item => item.id === parallelWith);
    const groupId = companion?.simultaneousId || companion?.id;
    const insertionIndex = companion
      ? destinationActivities.reduce((last, item, index) => item.id === companion.id || (groupId && item.simultaneousId === groupId) ? index + 1 : last, 0)
      : Math.min(position, destinationActivities.length);
    onSave(
      { id: activity.id, icon, simultaneousId: companion ? (companion.simultaneousId || companion.id) : undefined, label: label.trim() || icons.find(([value]) => value === icon)?.[1] || findOpenMoji(icon)?.name || customIcons.find(item => item.id === icon)?.name || 'Activity', who },
      { day: destinationDay, part: destinationPart, index: insertionIndex },
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
      <div className="section-title person-section-title person-section-heading">2. Who is doing it?</div>
      <p className={participantTokens(who, members).length >= maxPeoplePerActivity ? 'people-limit-warning' : 'hint'} role={participantTokens(who, members).length >= maxPeoplePerActivity ? 'status' : undefined}>
        Choose up to 4 pictures. A complete family, kids, or parents group counts as one.
      </p>
      <div className="activity-group-choices">{(['family', 'kids', 'parents'] as const).map(group => {
        const ids = members.filter(member => group === 'family' || (group === 'kids' ? memberRole(member) === 'child' : memberRole(member) !== 'child')).map(member => member.id);
        return <button key={group} type="button" className={`btn ${ids.length && ids.every(id => who.includes(id)) ? 'selected' : ''}`} aria-pressed={!!ids.length && ids.every(id => who.includes(id))} disabled={!ids.length} onClick={() => toggleGroup(group)}><GroupFace group={group} />{group === 'kids' ? 'Kids' : group === 'parents' ? 'Parents' : 'Family'}</button>;
      })}</div>
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
        <label className="hint destination-position">At the same time as<select className="mini-input" value={selectedParallel} onChange={event => setParallelWith(event.target.value)}>
          <option value="">No other activity</option>
          {parallelOptions.map(group => <option key={group[0].id} value={group[0].id} disabled={group.length >= maxActivitiesPerSection || sectionLayout(destinationActivities).groupCount >= 1}>{sortGroupedActivities(group, members).map(item => item.label).join(' + ')}</option>)}
        </select></label>
        {!selectedParallel && <label className="hint destination-position">Position<select className="mini-input" aria-label="Position" value={position} onChange={event => setPosition(Number(event.target.value))}>
          <option value={0}>First</option>
          {destinationActivities.map((item, index) => <option key={index} value={index + 1}>After {item.label}</option>)}
        </select></label>}
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
  const [selectedGroup, setSelectedGroup] = useState<FamilyGroup | null>(null);
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
    setDraft(current => ({ ...current, members: [...current.members, { id, name: '', emoji: '🧑', role: 'child' }] }));
    setSelectedId(id);
    setSelectedGroup(null);
    setQuery('');
  }

  function updateGroupIcon(group: FamilyGroup, emoji: string) {
    setDraft(current => ({ ...current, groupIcons: { ...defaultGroupIcons, ...current.groupIcons, [group]: emoji } }));
  }

  return <dialog ref={dialog} aria-labelledby="familyTitle" onClose={onClose}>
    <div className="modal-head"><h2 id="familyTitle">Customise family</h2><button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <label className="section-title" htmlFor="familyName">Planner name</label>
      <input id="familyName" className="mini-input" maxLength={40} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder={defaultFamily.name} />
      <div className="section-title person-section-title">Family members</div>
      <div className="family-members">{draft.members.map(member => <div className="family-member" key={member.id}>
        <button type="button" className={`member-emoji ${selectedId === member.id ? 'selected' : ''}`} onClick={() => { setSelectedId(member.id); setSelectedGroup(null); setQuery(''); }} aria-label={`Change icon for ${member.name || 'new member'}`} aria-pressed={selectedId === member.id}><MemberEmoji emoji={member.emoji} /></button>
        <input className="mini-input" maxLength={25} aria-label="Member name" placeholder="Name" value={member.name} onChange={event => updateMember(member.id, { name: event.target.value })} />
        <select className="member-role" aria-label={`Role for ${member.name || 'new member'}`} value={memberRole(member)} onChange={event => updateMember(member.id, { role: event.target.value as Family['members'][number]['role'] })}><option value="dad">Dad</option><option value="mum">Mum</option><option value="child">Child</option></select>
        <button type="button" className="remove-member" aria-label={`Remove ${member.name || 'new member'}`} disabled={draft.members.length === 1} onClick={() => {
          setDraft(current => ({ ...current, members: current.members.filter(person => person.id !== member.id) }));
          if (selectedId === member.id) setSelectedId(null);
        }}>Remove</button>
      </div>)}</div>
      <button type="button" className="btn add-member" onClick={addMember}>+ Add member</button>
      <div className="section-title person-section-title">Family groups</div>
      <p className="hint">Group pictures appear when everyone in a group joins an activity.</p>
      <div className="family-groups">{(['family', 'kids', 'parents'] as const).map(group => <button key={group} type="button" className={`person-choice ${selectedGroup === group ? 'selected' : ''}`} aria-pressed={selectedGroup === group} onClick={() => { setSelectedGroup(group); setSelectedId(null); setQuery(''); }}><FamilyContext.Provider value={draft}><GroupFace group={group} /></FamilyContext.Provider>{group === 'kids' ? 'Kids' : group === 'parents' ? 'Parents' : 'Family'}</button>)}</div>
      {selectedGroup && <section className="member-picker" aria-label={`Choose icon for ${selectedGroup}`}>
        <div className="section-title">Icon for {selectedGroup}</div>
        <input className="mini-input icon-search" type="search" aria-label="Search group emojis" placeholder="Search emojis" value={query} onChange={event => setQuery(event.target.value)} />
        <div className="custom-icon-upload"><button className="btn" type="button" onClick={() => setAddingCustomIcon(true)}>＋ Add custom icon</button></div>
        <div className="emoji-picker"><button type="button" className={`choice ${(draft.groupIcons?.[selectedGroup] ?? 'auto') === 'auto' ? 'selected' : ''}`} onClick={() => updateGroupIcon(selectedGroup, 'auto')}><FamilyContext.Provider value={draft}><GroupPicture group={selectedGroup} className="big" iconOverride="auto" /></FamilyContext.Provider><span>From members</span></button>
          {familyIcons.map(item => <button type="button" key={item.id} className={`choice ${draft.groupIcons?.[selectedGroup] === item.id ? 'selected' : ''}`} onClick={() => updateGroupIcon(selectedGroup, item.id)}><IconPicture emoji={item.id} className="big" /><span>{item.name}</span></button>)}
          {choices.map(entry => <button type="button" key={entry.hexcode} className={`choice ${findOpenMoji(draft.groupIcons?.[selectedGroup] ?? '')?.hexcode === entry.hexcode ? 'selected' : ''}`} onClick={() => updateGroupIcon(selectedGroup, entry.emoji)}><IconPicture emoji={entry.emoji} className="big" /><span>{entry.name}</span></button>)}
        </div>
      </section>}
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
    <div className="modal-foot"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={!draft.name.trim() || draft.members.some(member => !member.name.trim() || !member.emoji.trim())} onClick={() => onSave({ ...draft, name: draft.name.trim(), members: draft.members.map(member => ({ ...member, name: member.name.trim() })) })}>Save family ✓</button></div>
    {addingCustomIcon && <CustomIconDialog scope="family" onClose={() => setAddingCustomIcon(false)} onSave={icon => {
      const added = onAddCustomIcon(icon);
      if (selectedId) updateMember(selectedId, { emoji: added.id });
      if (selectedGroup) updateGroupIcon(selectedGroup, added.id);
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

function BackupDialog({ onExport, onImport, onClose }: {
  onExport: () => void; onImport: (backup: PlannerBackup) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ fileName: string; backup: PlannerBackup } | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);

  async function chooseFile(file: File) {
    setPending(null);
    setMessage('');
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('That backup file is too large (maximum 20 MB).');
      setPending({ fileName: file.name, backup: parseBackup(await file.text()) });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not read this backup.');
    } finally {
      if (input.current) input.current.value = '';
    }
  }

  function importPending() {
    if (!pending) return;
    try {
      onImport(pending.backup);
      setPending(null);
      setMessage('Backup imported successfully.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not import this backup.');
    }
  }

  return <dialog ref={dialog} className="backup-dialog" aria-labelledby="backupTitle" onClose={onClose}>
    <div className="modal-head"><h2 id="backupTitle">Backup</h2><button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <p className="settings-intro">Move your planner to another device with a backup file. It includes your family, week, calendar view, and custom images.</p>
      <section className="backup-option"><h3>Export</h3><p>Download a backup to send to your phone or keep for later.</p><button className="btn" type="button" onClick={() => {
        try { onExport(); setMessage('Backup downloaded. Send the file to your phone, then import it there.'); }
        catch { setMessage('Could not download the backup. Please try again.'); }
      }}>⬇️ Download backup</button></section>
      <section className="backup-option"><h3>Import</h3><p>Choose a Little Week backup file from this device.</p><button className="btn" type="button" onClick={() => input.current?.click()}>⬆️ Choose backup file</button><input ref={input} type="file" accept=".json,application/json" hidden aria-label="Choose Little Week backup" onChange={event => { const file = event.target.files?.[0]; if (file) void chooseFile(file); }} /></section>
      {pending && <div className="backup-confirm"><strong>{pending.fileName}</strong><span>{pending.backup.family.name} · {pending.backup.family.members.length} family members · {pending.backup.customIcons.length} custom icons</span><p>Importing will replace the planner data saved on this device.</p><div className="backup-confirm-actions"><button className="btn" type="button" onClick={() => setPending(null)}>Cancel</button><button className="btn primary" type="button" onClick={importPending}>Replace with backup</button></div></div>}
      {message && <p className="backup-message" role="status">{message}</p>}
    </div>
    <div className="modal-foot"><button className="btn" type="button" onClick={onClose}>Close</button></div>
  </dialog>;
}

export default function App() {
  const [fullscreen, setFullscreen] = useState(() => new URLSearchParams(window.location.search).get('fullscreen') === '1');
  const [family, setFamily] = useState<Family>(readFamily);
  const [week, setWeek] = useState<WeekPlan>(readWeek);
  const [customIcons, setCustomIcons] = useState<CustomIcon[]>(readCustomIcons);
  const [calendarSettings, setCalendarSettings] = useState(readCalendarSettings);
  const [editingCalendar, setEditingCalendar] = useState(false);
  const [editingCustomIcons, setEditingCustomIcons] = useState(false);
  const [editingBackup, setEditingBackup] = useState(false);
  const [today, setToday] = useState(() => new Date());
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [editingFamily, setEditingFamily] = useState(false);
  const [undoMove, setUndoMove] = useState<UndoMove | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const toastToken = useRef(0);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(new URLSearchParams(window.location.search).get('fullscreen') === '1');
    window.addEventListener('popstate', syncFullscreen);
    return () => window.removeEventListener('popstate', syncFullscreen);
  }, []);

  function changeFullscreen(enabled: boolean) {
    const url = new URL(window.location.href);
    if (enabled) url.searchParams.set('fullscreen', '1');
    else url.searchParams.delete('fullscreen');
    window.history.pushState(null, '', url);
    setFullscreen(enabled);
  }

  useEffect(() => {
    if (!fullscreen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      changeFullscreen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [fullscreen]);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(week)); } catch { /* Private browsing can block storage. */ } }, [week]);
  useEffect(() => { try { localStorage.setItem(familyStorageKey, JSON.stringify(family)); } catch { /* Private browsing can block storage. */ } }, [family]);
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
  const crowdedSections = displayedDays.flatMap(({ index, label }) => parts
    .filter(part => { const layout = sectionLayout(week[index][part.id]); return layout.slots > maxActivitiesPerSection || layout.groupCount > 1 || layout.largestGroup > 2; })
    .map(part => `${label} ${part.name.toLowerCase()}`));
  const oversizedActivities = displayedDays.flatMap(({ index }) => parts.flatMap(part =>
    week[index][part.id].filter(activity => participantTokens(activity.who, family.members).length > maxPeoplePerActivity).map(activity =>
      `${activity.label} (${participantTokens(activity.who, family.members).length} pictures)`)));
  const canFitPage = crowdedSections.length === 0 && oversizedActivities.length === 0;
  useEffect(() => {
    if (!fullscreen || canFitPage) return;
    const url = new URL(window.location.href);
    url.searchParams.delete('fullscreen');
    window.history.replaceState(null, '', url);
    setFullscreen(false);
  }, [fullscreen, canFitPage]);
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
    const error = calendarLimitError(before, after, family.members);
    if (error) { window.alert(error); return; }
    setWeek(after);
    showMove(before, after, id);
  }

  function saveActivity(activity: Activity, destination: ActivityDestination) {
    if (!target) return;
    const next = structuredClone(week);
    if (target.index !== null) next[target.day][target.part].splice(target.index, 1);
    const destinationItems = next[destination.day][destination.part];
    if (activity.simultaneousId) {
      const companion = destinationItems.find(item => item.id === activity.simultaneousId || item.simultaneousId === activity.simultaneousId);
      if (companion) companion.simultaneousId = activity.simultaneousId;
    }
    destinationItems.splice(destination.index ?? destinationItems.length, 0, activity);
    const error = calendarLimitError(week, next, family.members);
    if (error) { window.alert(error); return; }
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

  function updateCustomIcon(icon: CustomIcon): void {
    const next = customIcons.map(item => item.id === icon.id ? icon : item);
    try {
      saveCustomIcons(next);
    } catch {
      throw new Error('Could not save this icon on this device. Try a smaller image or free up browser storage.');
    }
    setCustomIcons(next);
  }

  function deleteCustomIcon(icon: CustomIcon): void {
    const inUse = icon.scope === 'family'
      ? family.members.filter(member => member.emoji === icon.id).length + Object.values(family.groupIcons ?? {}).filter(value => value === icon.id).length
      : week.reduce((total, day) => total + parts.reduce((count, part) => count + day[part.id].filter(activity => activity.icon === icon.id).length, 0), 0);
    const replacement = icon.scope === 'family' ? '🧑' : '🛝';
    const message = inUse
      ? `Delete “${icon.name}”? It is used ${inUse} ${inUse === 1 ? 'time' : 'times'} on your planner. Affected ${icon.scope === 'family' ? 'people and groups' : 'activities'} will use their default icon instead.`
      : `Delete “${icon.name}” from your custom icons?`;
    if (!window.confirm(message)) return;
    try {
      saveCustomIcons(customIcons.filter(item => item.id !== icon.id));
    } catch {
      throw new Error('Could not delete this icon on this device. Try again or free up browser storage.');
    }
    setCustomIcons(current => current.filter(item => item.id !== icon.id));
    if (icon.scope === 'family') {
      setFamily(current => ({ ...current, members: current.members.map(member => member.emoji === icon.id ? { ...member, emoji: replacement } : member),
        groupIcons: Object.fromEntries((['family', 'kids', 'parents'] as const).map(group => [group, current.groupIcons?.[group] === icon.id ? 'auto' : current.groupIcons?.[group] ?? 'auto'])) as Record<FamilyGroup, string> }));
    } else {
      setWeek(current => {
        const next = structuredClone(current);
        for (const day of next) for (const part of parts) for (const activity of day[part.id]) {
          if (activity.icon === icon.id) activity.icon = replacement;
        }
        return next;
      });
    }
  }

  function deleteActivityById(activity: Activity) {
    if (!window.confirm(`Delete “${activity.label || 'this activity'}” from the calendar?`)) return;
    setUndoMove(null);
    setWeek(current => {
      const position = findActivity(current, activity.id);
      if (!position) return current;
      const next = structuredClone(current);
      next[position.day][position.part].splice(position.index, 1);
      return next;
    });
    setTarget(null);
  }

  function deleteActivity() {
    if (!target || target.index === null) return;
    const activity = week[target.day][target.part][target.index];
    if (!activity) return;
    deleteActivityById(activity);
  }

  function reset() {
    if (window.confirm('Restore the sample week? Your edits will be replaced.')) {
      setUndoMove(null);
      setWeek(sampleWeekForFamily(family));
    }
  }

  function exportBackup() {
    const contents = JSON.stringify(createBackup(family, week, calendarSettings, customIcons), null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `little-week-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function importBackup(backup: PlannerBackup) {
    saveBackup(backup, localStorage);
    setFamily(backup.family);
    setWeek(backup.week);
    setCalendarSettings(backup.calendarSettings);
    setCustomIcons(backup.customIcons);
    setToday(new Date());
    setTarget(null);
    setUndoMove(null);
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

  return <FamilyContext.Provider value={family}><CustomIconsContext.Provider value={customIcons}><main className={`shell ${showBackToTop ? 'with-back-to-top' : ''} ${fullscreen && canFitPage ? 'fullscreen-calendar' : ''}`}>
    <header className="top">
      <div className="titleline"><img className="site-logo" src={`${import.meta.env.BASE_URL}logo/little-week.png`} alt="" /><div><h1>{family.name}</h1><p className="sub">The picture shows <strong>what</strong> we're doing. The little faces show <strong>who</strong> is doing it.</p></div></div>
      <div className="actions"><button className="btn" type="button" onClick={() => setEditingFamily(true)}>👨‍👩‍👧‍👦 Edit family</button><button className="btn" type="button" onClick={() => setEditingCalendar(true)}>📅 Calendar view: {calendarSettings.start === 'today' ? 'Today' : calendarSettings.start === 'sunday' ? 'Sunday' : 'Monday'}</button><button className="btn" type="button" onClick={() => setEditingCustomIcons(true)}>🎨 Custom icons</button><button className="btn" type="button" onClick={() => setEditingBackup(true)}>💾 Backup</button><button className="btn" type="button" onClick={reset}>↺ Reset example</button><button className="btn" type="button" disabled={!canFitPage} onClick={() => changeFullscreen(true)}>⛶ Full screen</button><button className="btn primary" type="button" disabled={!canFitPage} onClick={() => window.print()}>🖨️ Print A4</button></div>
    </header>
    {fullscreen && <div className="fullscreen-toolbar"><button className="btn" type="button" onClick={() => changeFullscreen(false)}>✕ Exit full screen</button></div>}
    <Legend />
    {!canFitPage && <p className="calendar-limit-warning" role="status">Full screen and one-page print are available after you simplify the saved activities. {crowdedSections.length > 0 && `Review ${crowdedSections.join(', ')}: each section holds up to 2 activities or groups, with at most 1 group of 2. `}{oversizedActivities.length > 0 && `These activities show more than 4 pictures: ${oversizedActivities.join('; ')}. Deselect people or complete a group until 4 pictures remain in each. `}Your activities are still saved below.</p>}
    <div className="intro">Tap an activity to edit it. Drag onto the highlighted area to group activities, or above or below to move them apart (touch and hold on mobile). Tap <strong>+</strong> to add another activity. No exact times needed.</div>
    <Calendar week={week} displayedDays={displayedDays} onEdit={setTarget} onDelete={deleteActivityById} onCommit={commitMove} />
    <p className="smallnote">Each time-of-day row fits its activities · Example activities only · Changes save on this device · A4 landscape print · Icons by <a href="https://openmoji.org/">OpenMoji</a> (<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>)</p>
    {showBackToTop && <button className="back-to-top" type="button" aria-label="Back to top" title="Back to top" onClick={() => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })}><span aria-hidden="true">↑</span></button>}
    {target && initialActivity && <ActivityEditor target={target} activity={initialActivity} week={week} onSave={saveActivity} onDelete={deleteActivity} onClose={() => setTarget(null)} onAddCustomIcon={addCustomIcon} />}
    {editingFamily && <FamilyEditor family={family} week={week} onSave={saveFamily} onClose={() => setEditingFamily(false)} onAddCustomIcon={addCustomIcon} />}
    {editingCalendar && <CalendarSettingsDialog settings={calendarSettings} onSave={settings => { setToday(new Date()); setCalendarSettings(settings); setEditingCalendar(false); }} onClose={() => setEditingCalendar(false)} />}
    {editingCustomIcons && <CustomIconsManager icons={customIcons} onAdd={addCustomIcon} onUpdate={updateCustomIcon} onDelete={deleteCustomIcon} onClose={() => setEditingCustomIcons(false)} />}
    {editingBackup && <BackupDialog onExport={exportBackup} onImport={importBackup} onClose={() => setEditingBackup(false)} />}
    {undoMove && <MoveToast message={undoMove.message} onUndo={() => { setWeek(undoMove.before); setUndoMove(null); }} onDismiss={() => setUndoMove(null)} />}
  </main></CustomIconsContext.Provider></FamilyContext.Provider>;
}
