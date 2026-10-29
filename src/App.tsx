import { useEffect, useRef, useState } from 'react';
import {
  days, icons, parts, people, personIds, readHideWords, readWeek,
  sampleWeek, storageKey, wordsStorageKey,
  type Activity, type PartId, type PersonId, type WeekPlan,
} from './planner';

interface EditTarget { day: number; part: PartId; index: number | null }

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

function ActivityCard({ activity, onEdit }: { activity: Activity; onEdit: () => void }) {
  return <button type="button" className="activity" onClick={onEdit} title={`Edit ${activity.label}`}>
    <span className="activity-emoji" aria-hidden="true">{activity.icon}</span>
    <span className="activity-details"><span className="activity-name">{activity.label}</span><Participants who={activity.who} /></span>
  </button>;
}

function DayPart({ day, part, activities, onEdit }: {
  day: number; part: typeof parts[number]; activities: Activity[]; onEdit: (target: EditTarget) => void;
}) {
  return <section className={`part ${part.id}`} aria-label={`${days[day]} ${part.name}`}>
    <div className="part-head"><span className="symbol" aria-hidden="true">{part.emoji}</span>{part.name}</div>
    <div className="activities" data-count={activities.length}>
      {activities.map((activity, index) => <ActivityCard key={index} activity={activity} onEdit={() => onEdit({ day, part: part.id, index })} />)}
    </div>
    <button type="button" className="add" onClick={() => onEdit({ day, part: part.id, index: null })} title={`Add an activity to ${days[day]} ${part.name}`}>+ Add</button>
  </section>;
}

function Calendar({ week, onEdit }: { week: WeekPlan; onEdit: (target: EditTarget) => void }) {
  return <section className="scroll" aria-label="Weekly family activities"><div className="calendar">
    {days.map((day, dayIndex) => <article className="day" key={day}>
      <div className="day-head">{day}</div>
      {parts.map(part => <DayPart key={part.id} day={dayIndex} part={part} activities={week[dayIndex][part.id]} onEdit={onEdit} />)}
    </article>)}
  </div></section>;
}

function ActivityEditor({ target, activity, onSave, onDelete, onClose }: {
  target: EditTarget; activity: Activity;
  onSave: (activity: Activity) => void; onDelete: () => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [icon, setIcon] = useState(activity.icon);
  const [label, setLabel] = useState(activity.label);
  const [who, setWho] = useState<PersonId[]>(activity.who);

  useEffect(() => { dialog.current?.showModal(); }, []);

  function chooseIcon(nextIcon: string, nextLabel: string) {
    const previous = icons.find(([value]) => value === icon);
    if (!previous || label === previous[1]) setLabel(nextLabel);
    setIcon(nextIcon);
  }

  function togglePerson(id: PersonId) {
    setWho(current => current.includes(id)
      ? current.filter(person => person !== id)
      : personIds.filter(person => current.includes(person) || person === id));
  }

  function save() {
    onSave({ icon, label: label.trim() || icons.find(([value]) => value === icon)?.[1] || 'Activity', who });
  }

  return <dialog ref={dialog} aria-labelledby="editTitle" onClose={onClose}>
    <div className="modal-head"><h2 id="editTitle">{target.index === null ? 'Add' : 'Edit'} · {days[target.day]} {parts.find(part => part.id === target.part)?.name}</h2>
      <button className="xclose" type="button" onClick={onClose} aria-label="Close">×</button></div>
    <div className="modal-body">
      <div className="section-title">1. What are you doing?</div>
      <div className="emoji-picker">{icons.map(([value, name]) => <button key={value} type="button" className={`choice ${value === icon ? 'selected' : ''}`} aria-label={name} aria-pressed={value === icon} onClick={() => chooseIcon(value, name)}>
        <span className="big">{value}</span><span>{name}</span>
      </button>)}</div>
      <label htmlFor="activityName" className="hint">Short label (optional for printing)</label>
      <input id="activityName" className="mini-input" maxLength={25} value={label} onChange={event => setLabel(event.target.value)} />
      <div className="section-title person-section-title">2. Who is doing it?</div>
      <div className="person-grid">{personIds.map(id => <button key={id} type="button" className={`person-choice ${who.includes(id) ? 'selected' : ''}`} aria-pressed={who.includes(id)} onClick={() => togglePerson(id)}>
        <Face id={id} />{people[id].name}
      </button>)}</div>
      <div className="modal-foot">
        {target.index === null ? <span /> : <button className="btn danger" type="button" onClick={onDelete}>Delete</button>}
        <div className="flex gap-2"><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" onClick={save}>Save ✓</button></div>
      </div>
    </div>
  </dialog>;
}

export default function App() {
  const [week, setWeek] = useState<WeekPlan>(readWeek);
  const [hideWords, setHideWords] = useState(readHideWords);
  const [target, setTarget] = useState<EditTarget | null>(null);

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(week)); } catch { /* Private browsing can block storage. */ } }, [week]);
  useEffect(() => { try { localStorage.setItem(wordsStorageKey, String(hideWords)); } catch { /* Private browsing can block storage. */ } }, [hideWords]);

  function saveActivity(activity: Activity) {
    if (!target) return;
    setWeek(current => {
      const next = structuredClone(current);
      if (target.index === null) next[target.day][target.part].push(activity);
      else next[target.day][target.part][target.index] = activity;
      return next;
    });
    setTarget(null);
  }

  function deleteActivity() {
    if (!target || target.index === null) return;
    setWeek(current => {
      const next = structuredClone(current);
      next[target.day][target.part].splice(target.index!, 1);
      return next;
    });
    setTarget(null);
  }

  function reset() {
    if (window.confirm('Restore the sample week? Your edits will be replaced.')) setWeek(structuredClone(sampleWeek));
  }

  const initialActivity = target && (target.index === null
    ? { icon: '🛝', label: 'Playground', who: ['ema'] as PersonId[] }
    : week[target.day][target.part][target.index]);

  return <main className={`shell ${hideWords ? 'hide-words' : ''}`}>
    <header className="top">
      <div className="titleline"><span className="rainbow" aria-hidden="true">🌈</span><div><h1>Our Week</h1><p className="sub">The picture shows <strong>what</strong> we're doing. The little faces show <strong>who</strong> is doing it.</p></div></div>
      <div className="actions"><button className="btn" type="button" onClick={() => setHideWords(value => !value)}>{hideWords ? '👀 Show words' : '🙈 Hide words'}</button><button className="btn" type="button" onClick={reset}>↺ Reset example</button><button className="btn primary" type="button" onClick={() => window.print()}>🖨️ Print A4</button></div>
    </header>
    <Legend />
    <div className="intro">Tap an activity to change its emoji or the people doing it. Tap <strong>+</strong> to add another activity. No exact times needed.</div>
    <Calendar week={week} onEdit={setTarget} />
    <p className="smallnote">All three time-of-day rows are the same height · Example activities only · Changes save on this device · A4 landscape print</p>
    {target && initialActivity && <ActivityEditor target={target} activity={initialActivity} onSave={saveActivity} onDelete={deleteActivity} onClose={() => setTarget(null)} />}
  </main>;
}
