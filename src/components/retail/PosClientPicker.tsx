import { useEffect, useRef, useState } from 'react';
import { Loader2, Mail, Search, UserPlus, UserRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { canEmailReceipt, usePosClients, type PosClient } from '@/hooks/usePosClients';
import { cn } from '@/lib/utils';

interface ClientSearchProps {
  onSelected: (client: PosClient) => void;
  /** Para enviar el ticket: el alta marca el consentimiento y exige el correo. */
  forReceipt?: boolean;
}

/** Buscar un cliente por nombre, correo o teléfono, o darlo de alta con lo mínimo. */
export function ClientSearch({ onSelected, forReceipt = false }: ClientSearchProps) {
  const { searchClients, createClient } = usePosClients();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PosClient[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(forReceipt);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const t = setTimeout(async () => {
      const rows = await searchClients(q);
      if (seq.current === mine) {
        setResults(rows);
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, searchClients]);

  const startCreate = () => {
    // Lo que se ha escrito en el buscador sirve de punto de partida.
    const q = query.trim();
    if (q.includes('@')) setEmail(q);
    else if (/^[\d\s+()-]{6,}$/.test(q)) setPhone(q);
    else setName(q);
    setCreating(true);
  };

  const save = async () => {
    setSaving(true);
    const r = await createClient({ name, email, phone, receiptConsent: consent });
    setSaving(false);
    if (r) onSelected(r.client);
  };

  if (creating) {
    const needsEmail = consent && !email.trim();
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="pos-client-name">Nombre</Label>
          <Input id="pos-client-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-client-email">Correo</Label>
          <Input id="pos-client-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pos-client-phone">Teléfono</Label>
          <Input id="pos-client-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <label className="flex items-start gap-2 text-sm">
          <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
          <span>El cliente acepta recibir el ticket por correo</span>
        </label>
        {needsEmail && <p className="text-xs text-destructive">Para el ticket por correo hace falta el correo.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCreating(false)} disabled={saving}>
            Volver
          </Button>
          <Button onClick={save} disabled={saving || !name.trim() || needsEmail}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Guardar cliente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Nombre, correo o teléfono"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8"
          autoFocus
        />
      </div>
      <div className="max-h-64 overflow-y-auto space-y-1">
        {searching && (
          <div className="flex justify-center py-3">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        )}
        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p className="text-sm text-muted-foreground py-2">Ningún cliente coincide.</p>
        )}
        {!searching &&
          results.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelected(c)}
              className="w-full text-left rounded-md border px-3 py-2 hover:bg-muted transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{c.name}</span>
                {canEmailReceipt(c) && <Mail className="w-4 h-4 text-primary shrink-0" aria-label="Acepta el ticket por correo" />}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {[c.email, c.phone].filter(Boolean).join(' · ') || 'Sin correo ni teléfono'}
              </div>
            </button>
          ))}
      </div>
      <Button variant="outline" className="w-full" onClick={startCreate}>
        <UserPlus className="w-4 h-4 mr-2" />
        Nuevo cliente
      </Button>
    </div>
  );
}

interface PosClientPickerProps {
  value: PosClient | null;
  onChange: (client: PosClient | null) => void;
  className?: string;
}

/** Cliente de la venta en el recibo del TPV (opcional: por defecto, «Mostrador»). */
export function PosClientPicker({ value, onChange, className }: PosClientPickerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {value ? (
        <div className={cn('flex items-center gap-2 rounded-md border px-3 py-2', className)}>
          <UserRound className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{value.name}</div>
            <div className="text-xs text-muted-foreground truncate">
              {value.email ?? 'Sin correo'}
              {canEmailReceipt(value) ? ' · ticket por correo' : ''}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(null)} aria-label="Quitar cliente">
            <X className="w-4 h-4" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className={cn('w-full justify-start', className)} onClick={() => setOpen(true)}>
          <UserRound className="w-4 h-4 mr-2" />
          Añadir cliente
        </Button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cliente de la venta</DialogTitle>
            <DialogDescription>Búscalo o dalo de alta. Si lo acepta, recibirá el ticket por correo.</DialogDescription>
          </DialogHeader>
          {open && (
            <ClientSearch
              onSelected={(c) => {
                onChange(c);
                setOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
