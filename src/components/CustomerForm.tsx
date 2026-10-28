import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { addCustomer, db, deleteCustomer, type Customer } from '../db';
import { useT } from '../i18n';
import { numInput, parseNum } from '../lib/format';
import { Modal, toast } from './ui';

/** Add or edit a customer. Calls onSaved with the id (or null after a delete). */
export function CustomerForm({
  open,
  onClose,
  customer,
  initialName = '',
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customer?: Customer;
  initialName?: string;
  onSaved?: (id: number | null) => void;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [opening, setOpening] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(customer?.name ?? initialName);
    setPhone(customer?.phone ?? '');
    setAddress(customer?.address ?? '');
    setOpening(numInput(customer?.openingBalance));
  }, [open, customer, initialName]);

  const save = async () => {
    if (!name.trim()) return toast(t.customerForm.needName);
    const now = Date.now();
    const fields = { name: name.trim(), phone: phone.trim(), address: address.trim(), openingBalance: parseNum(opening) };
    let id: number;
    if (customer) {
      await db.customers.update(customer.id, { ...fields, updatedAt: now });
      id = customer.id;
    } else {
      id = await addCustomer({ ...fields, createdAt: now, updatedAt: now });
    }
    toast(customer ? t.customerForm.updated : t.customerForm.added);
    onClose();
    onSaved?.(id);
  };

  const remove = async () => {
    if (!customer) return;
    if (!confirm(t.customerForm.confirmDelete(customer.name))) return;
    await deleteCustomer(customer.id);
    toast(t.customerForm.deleted);
    onClose();
    onSaved?.(null);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? t.customerForm.editTitle : t.common.newCustomer}
      footer={
        <>
          {customer && (
            <button className="btn danger-ghost" onClick={remove}>
              <Trash2 size={18} /> {t.common.delete}
            </button>
          )}
          <button className="btn primary grow" onClick={save}>
            {t.common.save}
          </button>
        </>
      }
    >
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="field">
          <span>{t.customerForm.name}</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t.customerForm.namePlaceholder} />
        </label>
        <label className="field">
          <span>{t.customerForm.phone}</span>
          <input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98xxxxxxxx" />
        </label>
        <label className="field">
          <span>{t.customerForm.address}</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t.common.optional} />
        </label>
        <label className="field">
          <span>{t.customerForm.opening}</span>
          <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="0" />
          <small>{t.customerForm.openingHelp}</small>
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
