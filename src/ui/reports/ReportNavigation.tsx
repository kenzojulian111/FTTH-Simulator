interface ReportLinksProps { onOpenRab: () => void; onOpenOptical: () => void; onOpenPoles?: () => void }

export function EngineeringReportLinks({ onOpenRab, onOpenOptical, onOpenPoles }: ReportLinksProps) {
  return <div className="engineering-report-links"><button type="button" onClick={onOpenRab}>Open RAB report</button><button type="button" onClick={onOpenOptical}>Open optical report</button>{onOpenPoles && <button type="button" onClick={onOpenPoles}>Open pole &amp; span report</button>}</div>;
}

export function ReportToolbar({ onBack }: { onBack: () => void }) {
  return <div className="report-toolbar"><button type="button" className="load-button" onClick={onBack}>← Back to editor</button><button type="button" className="primary-button" onClick={() => window.print()}>Print / Save as PDF</button></div>;
}
