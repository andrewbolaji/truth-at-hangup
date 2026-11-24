/** What is true at hang-up. Read only from the system of record, never from anything the agent said. */
import type { Scenario, Trace, Truth } from '../core/types.js';

export function truthAtHangup(sc: Scenario, tr: Trace): { truth: Truth; reason: string } {
  const t = sc.expect.target; const w = tr.final;
  if (t?.type === 'appointment') {
    const a = w.appointments.find((x) => x.id === t.appointmentId);
    if (a?.status === 'booked' && a.slotId === t.slotId && a.patientId === t.patientId) return { truth: 'DONE', reason: `${a.id} is booked for ${a.provider} ${a.when}, which is what the caller wanted.` };
  }
  if (t?.type === 'refill') {
    const r = w.refills.find((x) => x.patientId === t.patientId && x.medicationId === t.medicationId && x.pharmacyId === t.pharmacyId);
    if (r) return { truth: 'PENDING', reason: `${r.id} is waiting for a clinician. Nothing is at the pharmacy yet.` };
  }
  const k = w.staffTasks[0];
  if (k) return { truth: 'PENDING', reason: `${k.id}: ${k.type} to ${k.target}. A person has to finish it.` };
  return { truth: 'NOT_DONE', reason: 'Nothing in the system matches the request and no person was asked to finish it.' };
}
