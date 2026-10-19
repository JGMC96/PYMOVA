CREATE POLICY "Admins upload business logos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='business-logos' AND public.has_min_role(((storage.foldername(name))[1])::uuid, 'admin'::app_role));
CREATE POLICY "Admins update business logos" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id='business-logos' AND public.has_min_role(((storage.foldername(name))[1])::uuid, 'admin'::app_role));
CREATE POLICY "Admins delete business logos" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='business-logos' AND public.has_min_role(((storage.foldername(name))[1])::uuid, 'admin'::app_role));