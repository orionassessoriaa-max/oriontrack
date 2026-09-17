import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  GoogleMeetPermissionError,
  readMeetArtifacts,
} from '@/lib/integrations/googleMeetArtifacts';

type MeetingLead = {
  id: string;
  reuniao_link: string | null;
  reuniao_agendada_at: string | null;
};

export async function syncCommercialMeetingArtifacts(limit = 20) {
  const { data, error } = await supabaseAdmin
    .from('comercial_leads')
    .select('id,reuniao_link,reuniao_agendada_at,reuniao_artefatos_status')
    .not('reuniao_link', 'is', null)
    .not('reuniao_agendada_at', 'is', null)
    .lt('reuniao_agendada_at', new Date().toISOString())
    .gte('reuniao_agendada_at', new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString())
    .in('reuniao_artefatos_status', [
      'pending',
      'permission_required',
      'waiting',
      'in_progress',
      'transcript_pending',
      'error',
    ])
    .order('reuniao_artefatos_synced_at', { ascending: true, nullsFirst: true })
    .order('reuniao_agendada_at', { ascending: false })
    .limit(Math.min(50, Math.max(1, limit)));
  if (error) throw error;

  const result = { checked: 0, ready: 0, waiting: 0, permissionRequired: 0, failed: 0 };
  for (const lead of (data || []) as MeetingLead[]) {
    result.checked += 1;
    try {
      const artifacts = await readMeetArtifacts(String(lead.reuniao_link));
      const meetingAgeHours = lead.reuniao_agendada_at
        ? (Date.now() - new Date(lead.reuniao_agendada_at).getTime()) / 3_600_000
        : 0;
      const artifactStatus = artifacts.status === 'unavailable' && meetingAgeHours < 36
        ? 'transcript_pending'
        : artifacts.status;
      const update: Record<string, unknown> = {
        reuniao_artefatos_status: artifactStatus,
        reuniao_artefatos_synced_at: new Date().toISOString(),
      };
      if ('conferenceRecordName' in artifacts) {
        update.google_meet_conference_record_name = artifacts.conferenceRecordName;
      }
      if ('participants' in artifacts) update.reuniao_participantes = artifacts.participants;
      if ('transcript' in artifacts) update.reuniao_transcricao = artifacts.transcript;
      if ('transcriptUrl' in artifacts) update.reuniao_transcricao_url = artifacts.transcriptUrl;
      if ('summary' in artifacts && artifacts.summary) update.reuniao_resumo = artifacts.summary;
      const saved = await supabaseAdmin.from('comercial_leads').update(update).eq('id', lead.id);
      if (saved.error) throw saved.error;
      if (artifactStatus === 'ready') result.ready += 1;
      else result.waiting += 1;
    } catch (syncError) {
      const permissionRequired = syncError instanceof GoogleMeetPermissionError;
      await supabaseAdmin.from('comercial_leads').update({
        reuniao_artefatos_status: permissionRequired ? 'permission_required' : 'error',
        reuniao_artefatos_synced_at: new Date().toISOString(),
      }).eq('id', lead.id);
      if (permissionRequired) result.permissionRequired += 1;
      else {
        result.failed += 1;
        console.error('commercial_meeting_artifacts_sync_failed', {
          leadId: lead.id,
          message: syncError instanceof Error ? syncError.message : String(syncError),
        });
      }
    }
  }
  return result;
}
