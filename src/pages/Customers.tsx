import { useDeferredValue, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { CustomerForm } from '../components/CustomerForm';
import { AddFromSearch, CustomerCards, SearchField, useCustomerRows } from '../components/CustomerList';
import { TopBar } from '../components/ui';
import { isCashCustomer } from '../db';
import { useT } from '../i18n';
import { useLedger } from '../lib/hooks';

/** Every customer on a page of its own (from the side menu), with the search at the top. */
export default function Customers() {
  const t = useT();
  const ledger = useLedger();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const query = useDeferredValue(q);
  const rows = useCustomerRows(query);

  return (
    <div className="page">
      <TopBar
        menu
        title={t.nav.customers}
        sub={ledger ? t.customers.count(ledger.customers.filter((c) => !isCashCustomer(c)).length) : undefined}
        right={
          <button className="icon-btn" aria-label={t.common.newCustomer} onClick={() => setAdding(true)}>
            <UserPlus size={22} />
          </button>
        }
      />

      <SearchField value={q} onChange={setQ} />
      {rows && <AddFromSearch q={query} rows={rows} />}
      {rows && <CustomerCards rows={rows} memory="customers" resetOn={query} />}
      {rows && query.trim() && !rows.length && <p className="muted center">{t.customers.noMatch(query)}</p>}

      <CustomerForm open={adding} onClose={() => setAdding(false)} onSaved={(id) => id && nav(`/c/${id}`)} />
    </div>
  );
}
