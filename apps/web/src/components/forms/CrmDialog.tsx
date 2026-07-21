import type {
  CrmActivityType,
  CrmTaskPriority,
  OpportunityStage,
  OpportunitySummary
} from '@fmcgbyalex/contracts/commercial';
import { useState, type FormEvent } from 'react';
import { useApplication } from '../../state/ApplicationProvider';
import { useCommercial } from '../../state/CommercialProvider';
import { Modal } from '../Modal';

export type CrmAction =
  | 'account'
  | 'contact'
  | 'activity'
  | 'task'
  | 'opportunity'
  | { type: 'stage'; opportunity: OpportunitySummary };

export function CrmDialog({ action, onClose }: { action: CrmAction; onClose: () => void }) {
  if (action === 'account') return <AccountDialog onClose={onClose} />;
  if (action === 'contact') return <ContactDialog onClose={onClose} />;
  if (action === 'activity') return <ActivityDialog onClose={onClose} />;
  if (action === 'task') return <TaskDialog onClose={onClose} />;
  if (action === 'opportunity') return <OpportunityDialog onClose={onClose} />;
  return <StageDialog opportunity={action.opportunity} onClose={onClose} />;
}

function AccountDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const commercial = useCommercial();
  const currencyCode = application.session?.tenant.defaultCurrency ?? 'EUR';
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [accountType, setAccountType] = useState<'prospect' | 'customer' | 'distributor' | 'retailer'>('prospect');
  const [countryCode, setCountryCode] = useState('NL');
  const [partyId, setPartyId] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.createAccount({
        code,
        name,
        accountType,
        countryCode,
        currencyCode,
        ...(partyId ? { partyId } : {})
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  const eligibleParties = application.data.parties.filter((party) =>
    ['customer', 'distributor', 'retailer'].includes(party.type)
  );

  return (
    <Modal eyebrow="CRM foundation" title="Create commercial account" description="Accounts organize contacts, interactions, follow-ups, pipeline and sales documents." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>Account code</span><input required value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="BENELUX-RETAIL" /></label>
          <label><span>Account name</span><input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Benelux Retail Group" /></label>
          <label><span>Account type</span><select value={accountType} onChange={(event) => setAccountType(event.target.value as typeof accountType)}><option value="prospect">Prospect</option><option value="customer">Customer</option><option value="distributor">Distributor</option><option value="retailer">Retailer</option></select></label>
          <label><span>Country code</span><input required maxLength={2} value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} /></label>
          <label><span>Currency</span><input readOnly value={currencyCode} /></label>
          <label><span>Linked business party</span><select value={partyId} onChange={(event) => setPartyId(event.target.value)}><option value="">No linked party</option>{eligibleParties.map((party) => <option value={party.id} key={party.id}>{party.name} · {party.code}</option>)}</select></label>
        </div>
        <DialogActions busy={commercial.busyAction} label="Create account" onClose={onClose} />
      </form>
    </Modal>
  );
}

function ContactDialog({ onClose }: { onClose: () => void }) {
  const commercial = useCommercial();
  const accounts = commercial.crm?.accounts ?? [];
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [primary, setPrimary] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.createContact({
        accountId,
        firstName,
        lastName,
        ...(jobTitle.trim() ? { jobTitle: jobTitle.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(primary ? { primary: true } : {})
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="CRM contact" title="Add account contact" description="Contacts remain tenant scoped and can be linked to future activity records." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <label><span>Account</span><select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name} · {account.code}</option>)}</select></label>
        <div className="form-grid two-column">
          <label><span>First name</span><input required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></label>
          <label><span>Last name</span><input required value={lastName} onChange={(event) => setLastName(event.target.value)} /></label>
          <label><span>Job title</span><input value={jobTitle} onChange={(event) => setJobTitle(event.target.value)} /></label>
          <label><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
          <label className="checkbox-line"><input type="checkbox" checked={primary} onChange={(event) => setPrimary(event.target.checked)} /><span>Set as primary contact</span></label>
        </div>
        <DialogActions busy={commercial.busyAction} label="Add contact" onClose={onClose} disabled={!accountId} />
      </form>
    </Modal>
  );
}

function ActivityDialog({ onClose }: { onClose: () => void }) {
  const commercial = useCommercial();
  const accounts = commercial.crm?.accounts ?? [];
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const contacts = (commercial.crm?.contacts ?? []).filter((contact) => contact.accountId === accountId);
  const opportunities = (commercial.crm?.opportunities ?? []).filter((opportunity) => opportunity.accountId === accountId);
  const [contactId, setContactId] = useState('');
  const [opportunityId, setOpportunityId] = useState('');
  const [activityType, setActivityType] = useState<CrmActivityType>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.createActivity({
        accountId,
        activityType,
        subject,
        ...(contactId ? { contactId } : {}),
        ...(opportunityId ? { opportunityId } : {}),
        ...(body.trim() ? { body: body.trim() } : {})
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Account history" title="Log commercial activity" description="Record calls, emails, meetings and notes as immutable account history." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>Account</span><select required value={accountId} onChange={(event) => { setAccountId(event.target.value); setContactId(''); setOpportunityId(''); }}><option value="">Select account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
          <label><span>Activity type</span><select value={activityType} onChange={(event) => setActivityType(event.target.value as CrmActivityType)}><option value="note">Note</option><option value="call">Call</option><option value="email">Email</option><option value="meeting">Meeting</option></select></label>
          <label><span>Contact</span><select value={contactId} onChange={(event) => setContactId(event.target.value)}><option value="">No specific contact</option>{contacts.map((contact) => <option value={contact.id} key={contact.id}>{contact.displayName}</option>)}</select></label>
          <label><span>Opportunity</span><select value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)}><option value="">No linked opportunity</option>{opportunities.map((opportunity) => <option value={opportunity.id} key={opportunity.id}>{opportunity.name}</option>)}</select></label>
        </div>
        <label><span>Subject</span><input required value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label><span>Details</span><textarea rows={5} value={body} onChange={(event) => setBody(event.target.value)} /></label>
        <DialogActions busy={commercial.busyAction} label="Record activity" onClose={onClose} disabled={!accountId} />
      </form>
    </Modal>
  );
}

function TaskDialog({ onClose }: { onClose: () => void }) {
  const commercial = useCommercial();
  const accounts = commercial.crm?.accounts ?? [];
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const opportunities = (commercial.crm?.opportunities ?? []).filter((opportunity) => opportunity.accountId === accountId);
  const [opportunityId, setOpportunityId] = useState('');
  const [subject, setSubject] = useState('');
  const [detail, setDetail] = useState('');
  const [dueAt, setDueAt] = useState(defaultDueDateTime());
  const [priority, setPriority] = useState<CrmTaskPriority>('medium');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.createTask({
        accountId,
        subject,
        dueAt: new Date(dueAt).toISOString(),
        priority,
        ...(opportunityId ? { opportunityId } : {}),
        ...(detail.trim() ? { detail: detail.trim() } : {})
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Follow-up discipline" title="Schedule commercial task" description="Open tasks feed overdue and due-soon views in the CRM cockpit." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>Account</span><select required value={accountId} onChange={(event) => { setAccountId(event.target.value); setOpportunityId(''); }}><option value="">Select account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
          <label><span>Opportunity</span><select value={opportunityId} onChange={(event) => setOpportunityId(event.target.value)}><option value="">Account-level task</option>{opportunities.map((opportunity) => <option value={opportunity.id} key={opportunity.id}>{opportunity.name}</option>)}</select></label>
          <label><span>Due date and time</span><input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
          <label><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value as CrmTaskPriority)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        </div>
        <label><span>Subject</span><input required value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label><span>Details</span><textarea rows={4} value={detail} onChange={(event) => setDetail(event.target.value)} /></label>
        <DialogActions busy={commercial.busyAction} label="Schedule follow-up" onClose={onClose} disabled={!accountId || !dueAt} />
      </form>
    </Modal>
  );
}

function OpportunityDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const commercial = useCommercial();
  const accounts = commercial.crm?.accounts ?? [];
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [name, setName] = useState('');
  const [stage, setStage] = useState<OpportunityStage>('lead');
  const [expectedValue, setExpectedValue] = useState('');
  const [probability, setProbability] = useState('25');
  const [expectedCloseDate, setExpectedCloseDate] = useState('');
  const [nextAction, setNextAction] = useState('');
  const currencyCode = application.session?.tenant.defaultCurrency ?? 'EUR';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.createOpportunity({
        accountId,
        name,
        stage,
        expectedValueMinor: toMinorUnits(expectedValue),
        currencyCode,
        probabilityBasisPoints: Math.round(Number(probability) * 100),
        ...(expectedCloseDate ? { expectedCloseDate } : {}),
        ...(nextAction.trim() ? { nextAction: nextAction.trim() } : {})
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Commercial pipeline" title="Create opportunity" description="Expected and weighted values are stored in safe integer minor units." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <label><span>Account</span><select required value={accountId} onChange={(event) => setAccountId(event.target.value)}><option value="">Select account</option>{accounts.map((account) => <option value={account.id} key={account.id}>{account.name}</option>)}</select></label>
        <label><span>Opportunity name</span><input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="form-grid two-column">
          <label><span>Stage</span><select value={stage} onChange={(event) => setStage(event.target.value as OpportunityStage)}><option value="lead">Lead</option><option value="qualified">Qualified</option><option value="proposal">Proposal</option><option value="negotiation">Negotiation</option></select></label>
          <label><span>Expected value ({currencyCode})</span><input required inputMode="decimal" value={expectedValue} onChange={(event) => setExpectedValue(event.target.value)} placeholder="25000.00" /></label>
          <label><span>Probability (%)</span><input required type="number" min="0" max="100" step="1" value={probability} onChange={(event) => setProbability(event.target.value)} /></label>
          <label><span>Expected close date</span><input type="date" value={expectedCloseDate} onChange={(event) => setExpectedCloseDate(event.target.value)} /></label>
        </div>
        <label><span>Next action</span><textarea rows={3} value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label>
        <DialogActions busy={commercial.busyAction} label="Create opportunity" onClose={onClose} disabled={!accountId || !expectedValue} />
      </form>
    </Modal>
  );
}

function StageDialog({ opportunity, onClose }: { opportunity: OpportunitySummary; onClose: () => void }) {
  const commercial = useCommercial();
  const [stage, setStage] = useState<OpportunityStage>(opportunity.stage);
  const [probability, setProbability] = useState(String(opportunity.probabilityBasisPoints / 100));
  const [nextAction, setNextAction] = useState(opportunity.nextAction ?? '');

  function selectStage(nextStage: OpportunityStage) {
    setStage(nextStage);
    if (nextStage === 'won') setProbability('100');
    if (nextStage === 'lost') setProbability('0');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await commercial.updateOpportunityStage(opportunity.id, {
        stage,
        probabilityBasisPoints: Math.round(Number(probability) * 100),
        ...(nextAction.trim() ? { nextAction: nextAction.trim() } : {})
      });
      onClose();
    } catch {
      // Provider publishes structured errors.
    }
  }

  return (
    <Modal eyebrow="Pipeline control" title={opportunity.name} description={`${opportunity.accountName} · ${formatMoney(opportunity.expectedValueMinor, opportunity.currencyCode)}`} onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid two-column">
          <label><span>Stage</span><select value={stage} onChange={(event) => selectStage(event.target.value as OpportunityStage)}><option value="lead">Lead</option><option value="qualified">Qualified</option><option value="proposal">Proposal</option><option value="negotiation">Negotiation</option><option value="won">Won</option><option value="lost">Lost</option></select></label>
          <label><span>Probability (%)</span><input required type="number" min="0" max="100" step="1" value={probability} disabled={stage === 'won' || stage === 'lost'} onChange={(event) => setProbability(event.target.value)} /></label>
        </div>
        <label><span>Next action or outcome</span><textarea rows={4} value={nextAction} onChange={(event) => setNextAction(event.target.value)} /></label>
        <DialogActions busy={commercial.busyAction} label="Update pipeline" onClose={onClose} />
      </form>
    </Modal>
  );
}

function DialogActions({ busy, label, onClose, disabled = false }: { busy: string | null; label: string; onClose: () => void; disabled?: boolean }) {
  return <div className="form-actions"><button className="ghost-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={busy !== null || disabled}>{busy ?? label}</button></div>;
}

function defaultDueDateTime(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toMinorUnits(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error('Enter a valid monetary amount with at most two decimals.');
  const [whole = '0', fraction = ''] = normalized.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('The monetary value exceeds safe limits.');
  return result;
}

function formatMoney(valueMinor: number, currencyCode: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode }).format(valueMinor / 100);
}
