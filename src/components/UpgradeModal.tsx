import { Crown, CheckCircle2, MessageCircle, Sparkles, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Modal } from './ui';
import { useT } from '../i18n';
import { usePayConfig } from '../lib/pay';
import { openWhatsApp } from '../lib/share';

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  feature?: string;
}

export function UpgradeModal({ open, onClose, feature }: UpgradeModalProps) {
  const t = useT();
  const config = usePayConfig();

  const benefits = [
    t.upgrade?.benefitDesigns ?? '10 Premium Bill Designs',
    t.upgrade?.benefitLogo ?? 'Your Shop Logo on Bills',
    t.upgrade?.benefitThemes ?? 'Custom App Colors & Background Tones',
    t.upgrade?.benefitWa ?? 'Custom WhatsApp Sales & Reminder Messages',
    t.upgrade?.benefitWatermark ?? 'Remove HisabLite Watermark from Bills',
  ];

  return (
    <Modal open={open} onClose={onClose} title="" className="upgrade-sheet">
      <div className="upgrade-modal-content">
        <div className="upgrade-crown-glow">
          <div className="upgrade-crown-circle">
            <Crown size={32} className="upgrade-crown-icon" />
          </div>
        </div>

        <h2 className="upgrade-title">{t.upgrade?.title ?? 'HisabLite Premium'}</h2>
        <p className="upgrade-subtitle">
          {feature
            ? `${feature} — ${t.upgrade?.featureRequired ?? 'unlock with a Premium plan'}`
            : (t.upgrade?.subtitle ?? 'Unlock all professional tools for your shop')}
        </p>

        <div className="upgrade-benefits-list">
          {benefits.map((b, i) => (
            <div key={i} className="upgrade-benefit-item">
              <CheckCircle2 size={18} className="upgrade-check-icon" />
              <span>{b}</span>
            </div>
          ))}
        </div>

        <div className="upgrade-plans-preview">
          <div className="upgrade-plan-pill">
            <span className="plan-name">{t.plans?.monthly ?? 'Monthly'}</span>
            <strong>₹299</strong>
          </div>
          <div className="upgrade-plan-pill featured">
            <span className="plan-badge-mini">{t.plans?.best ?? 'Best'}</span>
            <span className="plan-name">{t.plans?.yearly ?? 'Yearly'}</span>
            <strong>₹1,450</strong>
          </div>
          <div className="upgrade-plan-pill">
            <span className="plan-name">{t.plans?.lifetime ?? 'Lifetime'}</span>
            <strong>₹5,000</strong>
          </div>
        </div>

        <div className="upgrade-actions">
          <Link to="/plans" className="btn primary big block" onClick={onClose}>
            <Sparkles size={18} /> {t.upgrade?.seePlans ?? 'See Plans & Upgrade'} <ArrowRight size={16} />
          </Link>
          {config?.supportPhone && (
            <button
              type="button"
              className="btn whatsapp block"
              onClick={() => {
                onClose();
                openWhatsApp(config.supportPhone, 'Hello! I want to upgrade my HisabLite account to Premium.');
              }}
            >
              <MessageCircle size={18} /> {t.upgrade?.whatsappUs ?? 'Talk to Admin on WhatsApp'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
