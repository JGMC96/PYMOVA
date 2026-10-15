import { useEffect, useMemo, useState } from 'react';
import { Printer, Save, Monitor, FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useTicketConfig } from '@/hooks/useTicketConfig';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import { printTicket, type TicketDoc } from '@/lib/ticket';
import { TicketPreview } from './TicketPreview';

type Form = {
  ticket_address: string; ticket_phone: string; ticket_website: string;
  ticket_header: string; ticket_footer: string; ticket_return_policy: string; ticket_show_logo: boolean;
};

export function TicketSettingsPanel() {
  const { business, prefs, setPrefs, taxRate, settingsApi } = useTicketConfig();
  const { isAdmin } = useRoleAccess('admin');
  const s = settingsApi.settings;
  const [form, setForm] = useState<Form>({
    ticket_address: '', ticket_phone: '', ticket_website: '',
    ticket_header: '', ticket_footer: '', ticket_return_policy: '', ticket_show_logo: true,
  });

  useEffect(() => {
    if (!s) return;
    setForm({
      ticket_address: s.ticket_address ?? '', ticket_phone: s.ticket_phone ?? '',
      ticket_website: s.ticket_website ?? '', ticket_header: s.ticket_header ?? '',
      ticket_footer: s.ticket_footer ?? '', ticket_return_policy: s.ticket_return_policy ?? '',
      ticket_show_logo: s.ticket_show_logo ?? true,
    });
  }, [s]);

  const liveBusiness = {
    ...business,
    address: form.ticket_address, phone: form.ticket_phone, website: form.ticket_website,
    header: form.ticket_header, footer: form.ticket_footer, returnPolicy: form.ticket_return_policy,
    showLogo: form.ticket_show_logo,
  };

  const sample: TicketDoc = useMemo(() => ({
    kind: 'test', number: 'PRUEBA-0001', createdAt: new Date(), taxRate,
    total: 214.1, paymentMethod: 'cash', cashReceived: 220, change: 5.9, cashier: 'Caja 1',
    lines: [
      { name: 'Botín Sorolla Piel Choco · T40', quantity: 1, unitPrice: 179, total: 179 },
      { name: 'Crema nutritiva calzado', quantity: 2, unitPrice: 19.5, total: 35.1, discount: 3.9 },
    ],
  }), [taxRate]);

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => settingsApi.updateSettings(
    Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() || null : v])),
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Monitor className="w-5 h-5 text-primary" />Impresora de este equipo</CardTitle>
            <CardDescription>Se guarda solo en este ordenador o tablet, así cada caja puede tener su impresora.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Ancho del papel</Label>
              <RadioGroup
                value={prefs.paperWidth}
                onValueChange={(v) => setPrefs({ ...prefs, paperWidth: v as '80' | '58' })}
                className="grid grid-cols-2 gap-3"
              >
                {[['80', '80 mm', 'Impresora de mostrador'], ['58', '58 mm', 'Impresora compacta o portátil']].map(([v, l, d]) => (
                  <Label key={v} htmlFor={`pw-${v}`} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer has-[:checked]:border-primary">
                    <RadioGroupItem id={`pw-${v}`} value={v} className="mt-0.5" />
                    <span><span className="font-medium block">{l}</span><span className="text-xs text-muted-foreground font-normal">{d}</span></span>
                  </Label>
                ))}
              </RadioGroup>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="autoprint">Imprimir automáticamente al cobrar</Label>
                <p className="text-xs text-muted-foreground">El ticket sale sin pulsar «Imprimir».</p>
              </div>
              <Switch id="autoprint" checked={prefs.autoPrint} onCheckedChange={(v) => setPrefs({ ...prefs, autoPrint: v })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="feed">Espacio final (líneas)</Label>
                <Input id="feed" type="number" min={0} max={10} value={prefs.feedLines}
                  onChange={(e) => setPrefs({ ...prefs, feedLines: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="copies">Copias por venta</Label>
                <Input id="copies" type="number" min={1} max={3} value={prefs.copies}
                  onChange={(e) => setPrefs({ ...prefs, copies: Math.max(1, Math.min(3, Number(e.target.value) || 1)) })} />
              </div>
            </div>
            <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Para que salga perfecto:</p>
              <p>1. Instala la impresora térmica en el ordenador y márcala como predeterminada.</p>
              <p>2. En el cuadro de impresión elige: márgenes «Ninguno», escala 100 % y desactiva «Encabezados y pies de página».</p>
              <p>3. En Chrome puedes saltarte ese cuadro abriendo Pymova con la opción <code>--kiosk-printing</code>.</p>
            </div>
            <Button variant="outline" onClick={() => printTicket(liveBusiness, sample, prefs)}>
              <Printer className="w-4 h-4 mr-2" />Imprimir ticket de prueba
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5 text-primary" />Datos del ticket</CardTitle>
            <CardDescription>
              Nombre, razón social y NIF se toman de Configuración → Mi Negocio. Aquí completas el resto. {!isAdmin && 'Solo propietarios y administradores pueden cambiarlos.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {settingsApi.isLoading ? <Skeleton className="h-40 w-full" /> : (
              <fieldset disabled={!isAdmin} className="space-y-4">
                <div className="space-y-1.5"><Label htmlFor="addr">Dirección de la tienda</Label>
                  <Textarea id="addr" rows={2} value={form.ticket_address} onChange={set('ticket_address')} placeholder={'Calle Colón 10\n46004 Valencia'} /></div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5"><Label htmlFor="tel">Teléfono</Label>
                    <Input id="tel" value={form.ticket_phone} onChange={set('ticket_phone')} /></div>
                  <div className="space-y-1.5"><Label htmlFor="web">Web o Instagram</Label>
                    <Input id="web" value={form.ticket_website} onChange={set('ticket_website')} placeholder="tuilus.com" /></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor="hdr">Mensaje de cabecera (opcional)</Label>
                  <Input id="hdr" value={form.ticket_header} onChange={set('ticket_header')} placeholder="Horario: L-S 10:00-20:30" /></div>
                <div className="space-y-1.5"><Label htmlFor="ret">Política de cambios y devoluciones</Label>
                  <Textarea id="ret" rows={2} value={form.ticket_return_policy} onChange={set('ticket_return_policy')} placeholder="Cambios en 30 días con este ticket y el producto sin usar." /></div>
                <div className="space-y-1.5"><Label htmlFor="ftr">Pie del ticket</Label>
                  <Input id="ftr" value={form.ticket_footer} onChange={set('ticket_footer')} placeholder="¡Gracias por su compra!" /></div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="logo">Mostrar logo del negocio</Label>
                  <Switch id="logo" checked={form.ticket_show_logo} onCheckedChange={(v) => setForm((f) => ({ ...f, ticket_show_logo: v }))} />
                </div>
                <Button onClick={save} disabled={settingsApi.isUpdating}>
                  <Save className="w-4 h-4 mr-2" />{settingsApi.isUpdating ? 'Guardando…' : 'Guardar datos del ticket'}
                </Button>
              </fieldset>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="lg:sticky lg:top-4 h-fit space-y-2">
        <p className="text-sm font-medium text-muted-foreground">Vista previa</p>
        <TicketPreview business={liveBusiness} doc={sample} prefs={prefs} />
      </div>
    </div>
  );
}
