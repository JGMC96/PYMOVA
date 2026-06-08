import { useState } from 'react';
import { RequireModule } from '@/components/auth/RequireModule';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { MarketingHeader } from '@/components/marketing/MarketingHeader';
import { MarketingCalendar } from '@/components/marketing/MarketingCalendar';
import { MarketingList } from '@/components/marketing/MarketingList';
import { PostFormDialog } from '@/components/marketing/PostFormDialog';
import { useMarketingPosts } from '@/hooks/useMarketingPosts';
import { useRoleAccess } from '@/hooks/useRoleAccess';
import type { MarketingPost } from '@/types/database';

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
  } = useMarketingPosts();
  const { isAdmin } = useRoleAccess('admin');

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

  const handleSelect = (post: MarketingPost) => {
    if (!isAdmin) return; // staff: read-only, no dialog
    setEditingPost(post);
    setDefaultDate(null);
    setDialogOpen(true);
  };

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
          </TabsList>
          <TabsContent value="calendar" className="mt-4">
            <MarketingCalendar
              posts={posts}
              onSelectPost={handleSelect}
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
        </Tabs>

        {isAdmin && (
          <PostFormDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            post={editingPost}
            defaultDate={defaultDate}
            teamMembers={teamMembers}
            onSubmit={handleSubmit}
            onDelete={deletePost}
            isSubmitting={isSubmitting}
          />
        )}
      </div>
    </RequireModule>
  );
}
