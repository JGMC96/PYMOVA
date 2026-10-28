import { useState } from 'react';
import { RequireModule } from '@/components/auth/RequireModule';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { MarketingCalendar } from '@/components/marketing/MarketingCalendar';
import { MarketingList } from '@/components/marketing/MarketingList';
import { PostFormDialog } from '@/components/marketing/PostFormDialog';
import { MarketingCampaigns } from '@/components/marketing/MarketingCampaigns';
import { CampaignFormDialog } from '@/components/marketing/CampaignFormDialog';
import { GoalFormDialog } from '@/components/marketing/GoalFormDialog';
import { MarketingIdeas } from '@/components/marketing/MarketingIdeas';
import { MarketingTasks } from '@/components/marketing/MarketingTasks';
import { TaskFormDialog } from '@/components/marketing/TaskFormDialog';
import { useBusiness } from '@/contexts/BusinessContext';
import { useMarketingPosts } from '@/hooks/useMarketingPosts';
import { useMarketingCampaigns } from '@/hooks/useMarketingCampaigns';
import { useMarketingTasks } from '@/hooks/useMarketingTasks';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import type { MarketingCampaign, MarketingGoal, MarketingPost, MarketingTask } from '@/types/database';

export default function Marketing() {
  const {
    posts,
    teamMembers,
    isLoading,
    filters,
    setFilters,
    createPost,
    updatePost,
    deletePost,
    fetchPosts,
  } = useMarketingPosts();
  const { campaigns, goals, saveCampaign, deleteCampaign, addKeyDates, saveGoal, deleteGoal } =
    useMarketingCampaigns();
  const { tasks, saveTask, deleteTask, setDone } = useMarketingTasks();
  const { isAdmin } = useRoleAccess('admin');
  const { user } = useBusiness();
  const userId = user?.id ?? null;

  // Campaña o objetivo abierto: null = cerrado, 'new' = nuevo.
  const [openCampaign, setOpenCampaign] = useState<MarketingCampaign | 'new' | null>(null);
  const [openGoal, setOpenGoal] = useState<MarketingGoal | 'new' | null>(null);
  const editingCampaign = openCampaign === 'new' ? null : openCampaign;
  const editingGoal = openGoal === 'new' ? null : openGoal;
  const [openTask, setOpenTask] = useState<MarketingTask | 'new' | null>(null);
  const editingTask = openTask === 'new' ? null : openTask;

  const myPendingTasks = tasks.filter((t) => !t.done_at && t.assignee_id === userId).length;
  const ideaCount = posts.filter((p) => p.status === 'idea').length;

  // Al borrar una campaña sus publicaciones se quedan sin ella: se vuelven a leer.
  const handleDeleteCampaign = async (id: string) => {
    const ok = await deleteCampaign(id);
    if (ok) await fetchPosts();
    return ok;
  };

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<MarketingPost | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleNew = (date?: Date) => {
    if (!isAdmin) return;
    setEditingPost(null);
    setDefaultDate(date ?? null);
    setDialogOpen(true);
  };

  // Nueva idea: cualquiera del equipo (el personal, solo en estado «Idea»).
  const handleNewIdea = () => {
    setEditingPost(null);
    setDefaultDate(null);
    setDialogOpen(true);
  };

  // El personal también abre la ficha: edita sus ideas y ve lo demás en solo lectura.
  const handleSelect = (post: MarketingPost) => {
    setEditingPost(post);
    setDefaultDate(null);
    setDialogOpen(true);
  };

  const ownIdea = !!editingPost && editingPost.status === 'idea' && editingPost.created_by === userId;
  const ideaOnly = !isAdmin && (editingPost ? ownIdea : true);

  const handleSubmit = async (data: Parameters<typeof createPost>[0]) => {
    setIsSubmitting(true);
    try {
      if (editingPost) return await updatePost(editingPost.id, data);
      return await createPost(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RequireModule module="marketing">
      <div className="space-y-6">
        <MarketingHeader
          filters={filters}
          onFiltersChange={setFilters}
          onNewPost={() => handleNew()}
          canEdit={isAdmin}
          teamMembers={teamMembers}
        />

        <Tabs defaultValue="calendar">
          <TabsList>
            <TabsTrigger value="calendar">Calendario</TabsTrigger>
            <TabsTrigger value="list">Lista</TabsTrigger>
            <TabsTrigger value="ideas">Ideas{ideaCount > 0 && ` (${ideaCount})`}</TabsTrigger>
            <TabsTrigger value="tasks">
              Tareas
              {myPendingTasks > 0 && (
                <span
                  className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground"
                  aria-label={`${myPendingTasks} tareas tuyas pendientes`}
                >
                  {myPendingTasks}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="campaigns">Campañas y objetivos</TabsTrigger>
          </TabsList>
          <TabsContent value="calendar" className="mt-4">
            <MarketingCalendar
              posts={posts}
              campaigns={campaigns}
              onSelectPost={handleSelect}
              onSelectCampaign={setOpenCampaign}
              onSelectDay={handleNew}
              canEdit={isAdmin}
            />
          </TabsContent>
          <TabsContent value="list" className="mt-4">
            <MarketingList
              posts={posts}
              isLoading={isLoading}
              teamMembers={teamMembers}
              onSelect={handleSelect}
              canEdit={isAdmin}
            />
          </TabsContent>
          <TabsContent value="ideas" className="mt-4">
            <MarketingIdeas
              posts={posts}
              teamMembers={teamMembers}
              campaigns={campaigns}
              onNew={handleNewIdea}
              onSelect={handleSelect}
            />
          </TabsContent>
          <TabsContent value="tasks" className="mt-4">
            <MarketingTasks
              tasks={tasks}
              teamMembers={teamMembers}
              campaigns={campaigns}
              currentUserId={userId}
              isAdmin={isAdmin}
              onNew={() => setOpenTask('new')}
              onSelect={setOpenTask}
              onToggle={setDone}
            />
          </TabsContent>
          <TabsContent value="campaigns" className="mt-4">
            <MarketingCampaigns
              campaigns={campaigns}
              goals={goals}
              posts={posts}
              canEdit={isAdmin}
              onNewCampaign={() => setOpenCampaign('new')}
              onSelectCampaign={setOpenCampaign}
              onAddKeyDates={addKeyDates}
              onNewGoal={() => setOpenGoal('new')}
              onSelectGoal={setOpenGoal}
            />
          </TabsContent>
        </Tabs>

        <PostFormDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          post={editingPost}
          defaultDate={defaultDate}
          teamMembers={teamMembers}
          campaigns={campaigns}
          onSubmit={handleSubmit}
          onDelete={isAdmin || ownIdea ? deletePost : undefined}
          isSubmitting={isSubmitting}
          readOnly={!isAdmin && !ideaOnly}
          ideaOnly={ideaOnly}
        />

        <CampaignFormDialog
          open={openCampaign !== null}
          onOpenChange={(open) => !open && setOpenCampaign(null)}
          campaign={editingCampaign}
          postCount={editingCampaign ? posts.filter((p) => p.campaign_id === editingCampaign.id).length : 0}
          onSubmit={(data) => saveCampaign(data, editingCampaign?.id)}
          onDelete={isAdmin ? handleDeleteCampaign : undefined}
          readOnly={!isAdmin}
        />

        <GoalFormDialog
          open={openGoal !== null}
          onOpenChange={(open) => !open && setOpenGoal(null)}
          goal={editingGoal}
          campaigns={campaigns}
          onSubmit={(data) => saveGoal(data, editingGoal?.id)}
          onDelete={isAdmin ? deleteGoal : undefined}
          readOnly={!isAdmin}
        />

        <TaskFormDialog
          open={openTask !== null}
          onOpenChange={(open) => !open && setOpenTask(null)}
          task={editingTask}
          teamMembers={teamMembers}
          campaigns={campaigns}
          posts={posts}
          onSubmit={(data) => saveTask(data, editingTask?.id)}
          onDelete={isAdmin ? deleteTask : undefined}
          readOnly={!isAdmin}
        />
      </div>
    </RequireModule>
  );
}
