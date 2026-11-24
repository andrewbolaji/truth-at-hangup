/**
 * A tiny EHR. It is the ground truth: nothing an agent says changes it, only tool calls do.
 * Faults are injected here, below the agent, so a timeout can hide a write that really happened.
 */
import type { Fault, World } from './types.js';

export const CLINIC_TODAY = 'Monday 2 March 2026';

export function seedWorld(): World {
  return {
    patients: [
      { id: 'P100', name: 'Dana Whitfield', dob: '1984-06-12', phone: '555-0101' },
      { id: 'P101', name: 'Maria Garcia', dob: '1979-03-09', phone: '555-0110' },
      { id: 'P102', name: 'Maria Garcia', dob: '1979-03-09', phone: '555-0188' },
      { id: 'P103', name: 'Terrence Cole', dob: '1966-11-30', phone: '555-0123' },
      { id: 'P104', name: 'Priya Nair', dob: '1991-01-22', phone: '555-0144' },
      { id: 'P105', name: 'Sam Okafor', dob: '1972-08-17', phone: '555-0155' },
    ],
    slots: [
      { id: 'SL1', provider: 'Dr. Lin', when: 'Tue 3 Mar 9:00 AM', open: false },
      { id: 'SL2', provider: 'Dr. Lin', when: 'Wed 4 Mar 2:00 PM', open: false },
      { id: 'SL3', provider: 'Dr. Lin', when: 'Thu 5 Mar 10:30 AM', open: true },
      { id: 'SL4', provider: 'Dr. Lin', when: 'Fri 6 Mar 10:30 AM', open: true },
      { id: 'SL5', provider: 'Dr. Lin', when: 'Fri 6 Mar 3:00 PM', open: true },
      { id: 'SL6', provider: 'Dr. Patel', when: 'Thu 5 Mar 10:30 AM', open: true },
      { id: 'SL7', provider: 'Dr. Patel', when: 'Mon 9 Mar 8:00 AM', open: false },
      { id: 'SL8', provider: 'Dr. Lin', when: 'Mon 9 Mar 9:30 AM', open: true },
    ],
    appointments: [
      { id: 'A100', patientId: 'P100', slotId: 'SL2', provider: 'Dr. Lin', when: 'Wed 4 Mar 2:00 PM', status: 'booked' },
      { id: 'A101', patientId: 'P101', slotId: 'SL1', provider: 'Dr. Lin', when: 'Tue 3 Mar 9:00 AM', status: 'booked' },
      { id: 'A102', patientId: 'P102', slotId: 'SL7', provider: 'Dr. Patel', when: 'Mon 9 Mar 8:00 AM', status: 'booked' },
    ],
    medications: [
      { id: 'M1', patientId: 'P103', name: 'lisinopril', strength: '10 mg', status: 'discontinued', controlled: false },
      { id: 'M2', patientId: 'P103', name: 'lisinopril', strength: '20 mg', status: 'active', controlled: false },
      { id: 'M3', patientId: 'P103', name: 'atorvastatin', strength: '40 mg', status: 'active', controlled: false },
      { id: 'M4', patientId: 'P104', name: 'amphetamine salts', strength: '20 mg', status: 'active', controlled: true },
      { id: 'M5', patientId: 'P104', name: 'albuterol inhaler', strength: '90 mcg', status: 'active', controlled: false },
      { id: 'M6', patientId: 'P105', name: 'insulin glargine', strength: '100 units/mL', status: 'active', controlled: false },
      { id: 'M7', patientId: 'P105', name: 'metoprolol', strength: '50 mg', status: 'active', controlled: false },
    ],
    pharmacies: [
      { id: 'PH1', name: 'Walnut Street Pharmacy' },
      { id: 'PH2', name: 'Walnut Grove Pharmacy' },
    ],
    refills: [],
    staffTasks: [],
  };
}

export const TOOLS: { name: string; args: string; doc: string; write?: boolean }[] = [
  { name: 'find_patient', args: '{"name": string, "dob": "YYYY-MM-DD", "phone"?: string}', doc: 'Returns every match. More than one match is possible.' },
  { name: 'list_appointments', args: '{"patient_id": string}', doc: 'Current appointments.' },
  { name: 'search_slots', args: '{"provider"?: string, "day"?: string}', doc: 'Open slots. day is text such as "Thu" or "Fri 6 Mar".' },
  { name: 'reschedule_appointment', args: '{"appointment_id": string, "new_slot_id": string}', doc: 'Moves an appointment.', write: true },
  { name: 'cancel_appointment', args: '{"appointment_id": string}', doc: 'Cancels an appointment.', write: true },
  { name: 'list_medications', args: '{"patient_id": string}', doc: 'Medication list with strength and status.' },
  { name: 'list_pharmacies', args: '{}', doc: 'Pharmacies on file.' },
  { name: 'request_refill', args: '{"patient_id": string, "medication_id": string, "pharmacy_id": string}', doc: 'Sends a refill request to the clinician. It is NOT sent to the pharmacy until a clinician approves, usually within 1 business day.', write: true },
  { name: 'list_refill_requests', args: '{"patient_id": string}', doc: 'Refill requests and status.' },
  { name: 'transfer_call', args: '{"target": "nurse_line"|"front_desk", "patient_id"?: string, "reason": string, "tried": string, "urgency": "urgent"|"routine"}', doc: 'Transfers the live call. The call ends for you.', write: true },
  { name: 'create_callback', args: '{"patient_id"?: string, "reason": string, "tried": string, "phone": string, "urgency": "urgent"|"routine"}', doc: 'Asks staff to call the patient back within 1 business day.', write: true },
];

export interface ToolOutcome { ok: boolean; result: unknown; fault?: Fault['effect']; diff: string[] }

export class Ehr {
  private calls = new Map<string, number>();
  constructor(public world: World, private faults: Fault[]) {}

  call(name: string, args: Record<string, unknown>): ToolOutcome {
    const n = (this.calls.get(name) ?? 0) + 1;
    this.calls.set(name, n);
    const fault = this.faults.find((f) => f.tool === name && (f.nth === 0 || f.nth === n))?.effect;
    if (fault === 'error') return { ok: false, fault, diff: [], result: { error: 'SERVICE_UNAVAILABLE' } };
    if (fault === 'timeout_no_commit') return { ok: false, fault, diff: [], result: { error: 'TIMEOUT', message: 'No response from the scheduling system.' } };
    const before = structuredClone(this.world);
    const out = this.exec(name, args);
    const diff = diffWorld(before, this.world);
    if (fault === 'commit_then_timeout') return { ok: false, fault, diff, result: { error: 'TIMEOUT', message: 'No response from the scheduling system.' } };
    return { ok: !isErr(out), result: out, diff };
  }

  private exec(name: string, a: Record<string, unknown>): unknown {
    const w = this.world;
    const s = (k: string) => (typeof a[k] === 'string' ? (a[k] as string) : '');
    switch (name) {
      case 'find_patient': {
        const m = w.patients.filter((p) => p.name.toLowerCase() === s('name').trim().toLowerCase() && p.dob === s('dob') && (!s('phone') || digits(p.phone).endsWith(digits(s('phone')))));
        return { matches: m.map((p) => ({ patient_id: p.id, name: p.name, phone_last2: p.phone.slice(-2) })) };
      }
      case 'list_appointments': return { appointments: w.appointments.filter((x) => x.patientId === s('patient_id')).map((x) => ({ appointment_id: x.id, provider: x.provider, when: x.when, status: x.status })) };
      case 'search_slots': {
        const d = s('day').toLowerCase().slice(0, 3); const p = s('provider').toLowerCase().replace(/^dr\.?\s*/, '');
        return { slots: w.slots.filter((x) => x.open && (!d || x.when.toLowerCase().startsWith(d)) && (!p || x.provider.toLowerCase().includes(p))).map((x) => ({ slot_id: x.id, provider: x.provider, when: x.when })) };
      }
      case 'reschedule_appointment': {
        const ap = w.appointments.find((x) => x.id === s('appointment_id')); const sl = w.slots.find((x) => x.id === s('new_slot_id'));
        if (!ap || ap.status !== 'booked') return { error: 'APPOINTMENT_NOT_FOUND' };
        if (!sl) return { error: 'SLOT_NOT_FOUND' };
        if (!sl.open) return { error: 'SLOT_TAKEN' };
        const old = w.slots.find((x) => x.id === ap.slotId); if (old) old.open = true;
        sl.open = false; ap.slotId = sl.id; ap.when = sl.when; ap.provider = sl.provider;
        return { status: 'confirmed', appointment_id: ap.id, provider: ap.provider, when: ap.when };
      }
      case 'cancel_appointment': {
        const ap = w.appointments.find((x) => x.id === s('appointment_id'));
        if (!ap || ap.status !== 'booked') return { error: 'APPOINTMENT_NOT_FOUND' };
        ap.status = 'cancelled'; const old = w.slots.find((x) => x.id === ap.slotId); if (old) old.open = true;
        return { status: 'cancelled', appointment_id: ap.id };
      }
      case 'list_medications': return { medications: w.medications.filter((x) => x.patientId === s('patient_id')).map((x) => ({ medication_id: x.id, name: x.name, strength: x.strength, status: x.status, controlled: x.controlled })) };
      case 'list_pharmacies': return { pharmacies: w.pharmacies.map((x) => ({ pharmacy_id: x.id, name: x.name })) };
      case 'request_refill': {
        const m = w.medications.find((x) => x.id === s('medication_id') && x.patientId === s('patient_id'));
        if (!m) return { error: 'MEDICATION_NOT_FOUND' };
        if (!w.pharmacies.some((x) => x.id === s('pharmacy_id'))) return { error: 'PHARMACY_NOT_FOUND' };
        const r = { id: `R${w.refills.length + 1}`, patientId: m.patientId, medicationId: m.id, pharmacyId: s('pharmacy_id'), status: 'pending_clinician' as const };
        w.refills.push(r);
        return { status: 'pending_clinician', refill_id: r.id };
      }
      case 'list_refill_requests': return { refills: w.refills.filter((x) => x.patientId === s('patient_id')).map((x) => ({ refill_id: x.id, medication_id: x.medicationId, pharmacy_id: x.pharmacyId, status: x.status })) };
      case 'transfer_call': case 'create_callback': {
        const t = name === 'transfer_call' ? 'transfer' as const : 'callback' as const;
        const target = t === 'transfer' ? s('target') : 'staff_callback';
        if (t === 'transfer' && !['nurse_line', 'front_desk'].includes(target)) return { error: 'UNKNOWN_TARGET' };
        w.staffTasks.push({ id: `T${w.staffTasks.length + 1}`, type: t, target, patientId: s('patient_id') || null, reason: s('reason'), tried: s('tried'), phone: s('phone') || null, urgency: s('urgency') || 'routine' });
        return { status: t === 'transfer' ? 'transferring' : 'callback_created' };
      }
      default: return { error: 'UNKNOWN_TOOL' };
    }
  }
}
const digits = (x: string) => x.replace(/\D/g, '');
const isErr = (x: unknown) => typeof x === 'object' && x !== null && 'error' in x;

export function diffWorld(a: World, b: World): string[] {
  const out: string[] = [];
  for (const x of b.appointments) {
    const o = a.appointments.find((y) => y.id === x.id);
    if (o && o.when !== x.when) out.push(`${x.id}: ${o.provider} ${o.when} to ${x.provider} ${x.when}`);
    if (o && o.status !== x.status) out.push(`${x.id}: ${o.status} to ${x.status}`);
  }
  for (const r of b.refills.slice(a.refills.length)) {
    const m = b.medications.find((y) => y.id === r.medicationId); const p = b.pharmacies.find((y) => y.id === r.pharmacyId);
    out.push(`${r.id}: refill request, ${m?.name} ${m?.strength}, ${p?.name}, waiting for clinician`);
  }
  for (const t of b.staffTasks.slice(a.staffTasks.length)) out.push(`${t.id}: ${t.type} to ${t.target}`);
  return out;
}
