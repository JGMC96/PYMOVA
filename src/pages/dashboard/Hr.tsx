import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Clock, CalendarDays, Users, CalendarRange, FileText } from 'lucide-react';
import { RequireModule } from '@/components/auth/RequireModule';
import { useBusiness } from '@/contexts/BusinessContext';
import { useTimeClock } from '@/hooks/useTimeClock';
import { TimeClockCard } from '@/components/hr/TimeClockCard';
import { TimeEntriesList } from '@/components/hr/TimeEntriesList';
import { VacationBalanceCard } from '@/components/hr/VacationBalanceCard';
import { AbsenceRequestDialog } from '@/components/hr/AbsenceRequestDialog';
import { AbsencesList } from '@/components/hr/AbsencesList';
import { EmployeesTable } from '@/components/hr/EmployeesTable';
import { TeamAbsenceCalendar } from '@/components/hr/TeamAbsenceCalendar';
import { ScheduleCalendar } from '@/components/hr/ScheduleCalendar';
import { MonthlyReport } from '@/components/hr/MonthlyReport';

function HrInner() {
  const { userRole } = useBusiness();
  const isAdmin = userRole === 'admin' || userRole === 'owner';
  const { dashboard, todayEntries } = useTimeClock();
  const [tab, setTab] = useState('clock');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-display font-bold">Recursos Humanos</h1>
        <p className="text-muted-foreground">Fichaje, vacaciones, permisos y planificación</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-2 sm:grid-cols-5 w-full sm:w-auto">
          <TabsTrigger value="clock" className="gap-2">
            <Clock className="w-4 h-4" /> Fichaje
          </TabsTrigger>
          <TabsTrigger value="absences" className="gap-2">
            <CalendarDays className="w-4 h-4" /> Ausencias
          </TabsTrigger>
          {isAdmin && (
            <>
              <TabsTrigger value="team" className="gap-2">
                <Users className="w-4 h-4" /> Equipo
              </TabsTrigger>
              <TabsTrigger value="schedule" className="gap-2">
                <CalendarRange className="w-4 h-4" /> Turnos
              </TabsTrigger>
              <TabsTrigger value="reports" className="gap-2">
                <FileText className="w-4 h-4" /> Reportes
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="clock" className="space-y-6 mt-6">
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <TimeClockCard />
            </div>
            <VacationBalanceCard dashboard={dashboard} />
          </div>
          <TimeEntriesList entries={todayEntries} />
        </TabsContent>

        <TabsContent value="absences" className="space-y-4 mt-6">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Mis solicitudes</h2>
            <AbsenceRequestDialog />
          </div>
          <AbsencesList scope="mine" />
          {isAdmin && (
            <>
              <h2 className="text-lg font-semibold pt-4">Solicitudes del equipo</h2>
              <AbsencesList scope="team" canReview />
            </>
          )}
        </TabsContent>

        {isAdmin && (
          <>
            <TabsContent value="team" className="space-y-6 mt-6">
              <TeamAbsenceCalendar />
              <EmployeesTable />
            </TabsContent>
            <TabsContent value="schedule" className="mt-6">
              <ScheduleCalendar />
            </TabsContent>
            <TabsContent value="reports" className="mt-6">
              <MonthlyReport />
            </TabsContent>
          </>
        )}
      </Tabs>
    </div>
  );
}

export default function Hr() {
  return (
    <RequireModule module="hr">
      <HrInner />
    </RequireModule>
  );
}
