import { renderTicketBody, ticketStyles, type TerminalTicketPrefs, type TicketBusiness, type TicketDoc } from '@/lib/ticket';
import { cn } from '@/lib/utils';

/** Simulación del rollo térmico: blanco y negro como sale de la impresora. */
export function TicketPreview({
  business, doc, prefs, className,
}: { business: TicketBusiness; doc: TicketDoc; prefs: TerminalTicketPrefs; className?: string }) {
  const html = `<style>${ticketStyles(prefs.paperWidth, 1).replace(/@page[^}]*}/, '')}</style><div class="ticket">${renderTicketBody(business, doc)}</div>`;
  return (
    <div className={cn('overflow-auto rounded-lg bg-muted p-4', className)}>
      <div
        className="mx-auto shadow-md"
        style={{ width: prefs.paperWidth === '58' ? '58mm' : '80mm' }}
      >
        <iframe
          title="Vista previa del ticket"
          srcDoc={`<!DOCTYPE html><html><body style="margin:0">${html}</body></html>`}
          className="w-full border-0 bg-background"
          style={{ height: 0 }}
          onLoad={(e) => {
            const f = e.currentTarget;
            const h = f.contentDocument?.body.scrollHeight ?? 600;
            f.style.height = `${h + 8}px`;
          }}
        />
      </div>
    </div>
  );
}
