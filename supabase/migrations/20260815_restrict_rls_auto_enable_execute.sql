-- Keep the ddl_command_end event trigger active while preventing direct API execution
-- of its SECURITY DEFINER event-trigger function.
revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
