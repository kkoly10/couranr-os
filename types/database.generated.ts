export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      addresses: {
        Row: {
          address_line: string
          business_account_id: string | null
          business_hours: string | null
          city: string | null
          country: string | null
          created_at: string | null
          id: string
          is_business: boolean | null
          label: string | null
          lat: number | null
          lng: number | null
          place_id: string | null
          state: string | null
          zip: string | null
        }
        Insert: {
          address_line: string
          business_account_id?: string | null
          business_hours?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_business?: boolean | null
          label?: string | null
          lat?: number | null
          lng?: number | null
          place_id?: string | null
          state?: string | null
          zip?: string | null
        }
        Update: {
          address_line?: string
          business_account_id?: string | null
          business_hours?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          id?: string
          is_business?: boolean | null
          label?: string | null
          lat?: number | null
          lng?: number | null
          place_id?: string | null
          state?: string | null
          zip?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "addresses_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "addresses_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      business_account_packages: {
        Row: {
          business_account_id: string
          business_package_id: string
          created_at: string
          ends_at: string | null
          id: string
          renews_at: string | null
          starts_at: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          business_account_id: string
          business_package_id: string
          created_at?: string
          ends_at?: string | null
          id?: string
          renews_at?: string | null
          starts_at?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          business_account_id?: string
          business_package_id?: string
          created_at?: string
          ends_at?: string | null
          id?: string
          renews_at?: string | null
          starts_at?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_account_packages_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "business_account_packages_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_account_packages_business_package_id_fkey"
            columns: ["business_package_id"]
            isOneToOne: false
            referencedRelation: "business_packages"
            referencedColumns: ["id"]
          },
        ]
      }
      business_accounts: {
        Row: {
          billing_email: string | null
          created_at: string
          created_by: string | null
          id: string
          legal_name: string | null
          name: string
          notes: string | null
          phone: string | null
          slug: string | null
          status: string
          timezone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          billing_email?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          legal_name?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          slug?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          billing_email?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          legal_name?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          slug?: string | null
          status?: string
          timezone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      business_jobs: {
        Row: {
          business_account_id: string
          completed_at: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          job_type: string
          priority: string
          route_template_id: string | null
          schedule_id: string | null
          scheduled_for: string | null
          source: string
          started_at: string | null
          status: string
          title: string | null
          updated_at: string
        }
        Insert: {
          business_account_id: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          job_type: string
          priority?: string
          route_template_id?: string | null
          schedule_id?: string | null
          scheduled_for?: string | null
          source?: string
          started_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          business_account_id?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          job_type?: string
          priority?: string
          route_template_id?: string | null
          schedule_id?: string | null
          scheduled_for?: string | null
          source?: string
          started_at?: string | null
          status?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_jobs_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "business_jobs_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_jobs_route_template_id_fkey"
            columns: ["route_template_id"]
            isOneToOne: false
            referencedRelation: "business_route_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_jobs_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "business_route_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      business_members: {
        Row: {
          business_account_id: string
          created_at: string
          id: string
          invited_by: string | null
          invited_email: string | null
          joined_at: string | null
          role: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          business_account_id: string
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          role: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          business_account_id?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          invited_email?: string | null
          joined_at?: string | null
          role?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "business_members_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      business_packages: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          id: string
          included_delivery_routes: number
          included_docs_jobs: number
          monthly_price_cents: number
          name: string
          overage_delivery_route_cents: number
          overage_docs_job_cents: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          id?: string
          included_delivery_routes?: number
          included_docs_jobs?: number
          monthly_price_cents: number
          name: string
          overage_delivery_route_cents?: number
          overage_docs_job_cents?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          included_delivery_routes?: number
          included_docs_jobs?: number
          monthly_price_cents?: number
          name?: string
          overage_delivery_route_cents?: number
          overage_docs_job_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      business_route_schedules: {
        Row: {
          business_account_id: string
          created_at: string
          created_by: string | null
          cron_expr: string | null
          day_of_month: number | null
          end_date: string | null
          id: string
          last_run_at: string | null
          next_run_at: string | null
          recurrence_type: string
          route_template_id: string
          start_date: string
          status: string
          timezone: string
          updated_at: string
          weekdays: number[] | null
          window_end_local: string
          window_start_local: string
        }
        Insert: {
          business_account_id: string
          created_at?: string
          created_by?: string | null
          cron_expr?: string | null
          day_of_month?: number | null
          end_date?: string | null
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          recurrence_type: string
          route_template_id: string
          start_date?: string
          status?: string
          timezone?: string
          updated_at?: string
          weekdays?: number[] | null
          window_end_local?: string
          window_start_local?: string
        }
        Update: {
          business_account_id?: string
          created_at?: string
          created_by?: string | null
          cron_expr?: string | null
          day_of_month?: number | null
          end_date?: string | null
          id?: string
          last_run_at?: string | null
          next_run_at?: string | null
          recurrence_type?: string
          route_template_id?: string
          start_date?: string
          status?: string
          timezone?: string
          updated_at?: string
          weekdays?: number[] | null
          window_end_local?: string
          window_start_local?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_route_schedules_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "business_route_schedules_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_route_schedules_route_template_id_fkey"
            columns: ["route_template_id"]
            isOneToOne: false
            referencedRelation: "business_route_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      business_route_templates: {
        Row: {
          active: boolean
          business_account_id: string
          cost_center: string | null
          created_at: string
          created_by: string | null
          default_notes: string | null
          default_rush: boolean
          default_signature_required: boolean
          default_stops: number | null
          default_weight_lbs: number | null
          dropoff_address_id: string | null
          external_ref: string | null
          id: string
          name: string
          pickup_address_id: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          business_account_id: string
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          default_notes?: string | null
          default_rush?: boolean
          default_signature_required?: boolean
          default_stops?: number | null
          default_weight_lbs?: number | null
          dropoff_address_id?: string | null
          external_ref?: string | null
          id?: string
          name: string
          pickup_address_id?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          business_account_id?: string
          cost_center?: string | null
          created_at?: string
          created_by?: string | null
          default_notes?: string | null
          default_rush?: boolean
          default_signature_required?: boolean
          default_stops?: number | null
          default_weight_lbs?: number | null
          dropoff_address_id?: string | null
          external_ref?: string | null
          id?: string
          name?: string
          pickup_address_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_route_templates_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "business_route_templates_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_route_templates_dropoff_address_id_fkey"
            columns: ["dropoff_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_route_templates_pickup_address_id_fkey"
            columns: ["pickup_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_usage_events: {
        Row: {
          business_account_id: string
          business_job_id: string | null
          created_at: string
          id: string
          occurred_at: string
          quantity: number
          reference_id: string | null
          reference_table: string | null
          total_cents: number | null
          unit_price_cents: number
          usage_type: string
        }
        Insert: {
          business_account_id: string
          business_job_id?: string | null
          created_at?: string
          id?: string
          occurred_at?: string
          quantity?: number
          reference_id?: string | null
          reference_table?: string | null
          total_cents?: number | null
          unit_price_cents?: number
          usage_type: string
        }
        Update: {
          business_account_id?: string
          business_job_id?: string | null
          created_at?: string
          id?: string
          occurred_at?: string
          quantity?: number
          reference_id?: string | null
          reference_table?: string | null
          total_cents?: number | null
          unit_price_cents?: number
          usage_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_usage_events_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "business_usage_events_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_usage_events_business_job_id_fkey"
            columns: ["business_job_id"]
            isOneToOne: false
            referencedRelation: "business_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_assignment_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          assignment_id: string
          command: string
          created_at: string
          delivery_id: string
          from_state: string | null
          id: string
          metadata: Json
          to_state: string | null
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          assignment_id: string
          command: string
          created_at?: string
          delivery_id: string
          from_state?: string | null
          id?: string
          metadata?: Json
          to_state?: string | null
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          assignment_id?: string
          command?: string
          created_at?: string
          delivery_id?: string
          from_state?: string | null
          id?: string
          metadata?: Json
          to_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_ae_assignment_fk"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_ae_delivery_fk"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_conversation_events: {
        Row: {
          actor_kind: string
          actor_user_id: string | null
          conversation_id: string
          created_at: string
          event_type: string
          id: string
          message_id: string | null
          metadata: Json
        }
        Insert: {
          actor_kind: string
          actor_user_id?: string | null
          conversation_id: string
          created_at?: string
          event_type: string
          id?: string
          message_id?: string | null
          metadata?: Json
        }
        Update: {
          actor_kind?: string
          actor_user_id?: string | null
          conversation_id?: string
          created_at?: string
          event_type?: string
          id?: string
          message_id?: string | null
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "couranr_conversation_events_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "couranr_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_conversation_events_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "couranr_conversation_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_conversation_messages: {
        Row: {
          author_participant_id: string | null
          author_user_id: string | null
          authorship: string
          body: string
          conversation_id: string
          created_at: string
          id: string
          idempotency_key: string
          topic: string | null
          visibility: string
        }
        Insert: {
          author_participant_id?: string | null
          author_user_id?: string | null
          authorship?: string
          body: string
          conversation_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          topic?: string | null
          visibility?: string
        }
        Update: {
          author_participant_id?: string | null
          author_user_id?: string | null
          authorship?: string
          body?: string
          conversation_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          topic?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "couranr_conversation_messages_author_participant_id_fkey"
            columns: ["author_participant_id"]
            isOneToOne: false
            referencedRelation: "couranr_conversation_participants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "couranr_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_cvm_author_in_conversation_fkey"
            columns: ["author_participant_id", "conversation_id"]
            isOneToOne: false
            referencedRelation: "couranr_conversation_participants"
            referencedColumns: ["id", "conversation_id"]
          },
        ]
      }
      couranr_conversation_participants: {
        Row: {
          access_token_id: string | null
          conversation_id: string
          id: string
          joined_at: string
          last_read_at: string | null
          left_at: string | null
          member_role: string | null
          participant_kind: string
          user_id: string | null
        }
        Insert: {
          access_token_id?: string | null
          conversation_id: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          member_role?: string | null
          participant_kind: string
          user_id?: string | null
        }
        Update: {
          access_token_id?: string | null
          conversation_id?: string
          id?: string
          joined_at?: string
          last_read_at?: string | null
          left_at?: string | null
          member_role?: string | null
          participant_kind?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_conversation_participants_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "couranr_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_cvp_help_token_fkey"
            columns: ["access_token_id"]
            isOneToOne: false
            referencedRelation: "couranr_help_access_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_conversations: {
        Row: {
          awaiting_reply_kind: string | null
          business_account_id: string
          created_at: string
          delivery_id: string | null
          due_state: string
          first_couranr_response_at: string | null
          id: string
          kind: string
          next_operating_period_at: string | null
          received_at: string | null
          request_id: string | null
          response_due_at: string | null
          status: string
          updated_at: string
          urgency: string
          version: number
          waiting_on: string | null
        }
        Insert: {
          awaiting_reply_kind?: string | null
          business_account_id: string
          created_at?: string
          delivery_id?: string | null
          due_state?: string
          first_couranr_response_at?: string | null
          id?: string
          kind: string
          next_operating_period_at?: string | null
          received_at?: string | null
          request_id?: string | null
          response_due_at?: string | null
          status?: string
          updated_at?: string
          urgency?: string
          version?: number
          waiting_on?: string | null
        }
        Update: {
          awaiting_reply_kind?: string | null
          business_account_id?: string
          created_at?: string
          delivery_id?: string | null
          due_state?: string
          first_couranr_response_at?: string | null
          id?: string
          kind?: string
          next_operating_period_at?: string | null
          received_at?: string | null
          request_id?: string | null
          response_due_at?: string | null
          status?: string
          updated_at?: string
          urgency?: string
          version?: number
          waiting_on?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_conversations_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_conversations_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_conversations_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_conversations_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_deliveries: {
        Row: {
          business_account_id: string | null
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          quote_version_id: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        Insert: {
          business_account_id?: string | null
          captured_amount_cents: number
          created_at?: string
          currency: string
          dropoff_address: Json
          fulfillment_state?: string
          id?: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          quote_version_id: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_requirement: Json
          version?: number
        }
        Update: {
          business_account_id?: string | null
          captured_amount_cents?: number
          created_at?: string
          currency?: string
          dropoff_address?: Json
          fulfillment_state?: string
          id?: string
          payment_obligation_id?: string
          pickup_address?: Json
          pricing_policy_version?: string
          proof_method?: string
          quote_version_id?: string
          recipient?: Json
          request_id?: string
          request_version?: number
          scheduled_pickup_end?: string
          scheduled_pickup_start?: string
          service_level?: string
          service_plan_id?: string
          shipment?: Json
          signature_required?: boolean
          timezone?: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_requirement?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "couranr_dlv_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_dlv_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_dlv_dispatch_vehicle_fk"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "couranr_dispatch_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_dlv_obligation_fk"
            columns: ["payment_obligation_id"]
            isOneToOne: false
            referencedRelation: "couranr_payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_dlv_plan_fk"
            columns: ["service_plan_id"]
            isOneToOne: false
            referencedRelation: "couranr_service_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_dlv_quote_request_fk"
            columns: ["quote_version_id", "request_id"]
            isOneToOne: false
            referencedRelation: "couranr_quote_versions"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "couranr_dlv_request_fk"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_delivery_access_tokens: {
        Row: {
          audience: string
          business_account_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          request_id: string
          revoked_at: string | null
          revoked_reason: string | null
          token_hash: string
        }
        Insert: {
          audience?: string
          business_account_id: string
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          request_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          token_hash: string
        }
        Update: {
          audience?: string
          business_account_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          request_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "couranr_dat_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_dat_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_dat_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_delivery_assignments: {
        Row: {
          assigned_at: string
          assigned_by: string
          assignment_state: string
          created_at: string
          delivery_id: string
          driver_id: string
          end_reason: string | null
          ended_at: string | null
          id: string
          idempotency_key: string | null
          updated_at: string
          vehicle_id: string
          version: number
        }
        Insert: {
          assigned_at?: string
          assigned_by: string
          assignment_state?: string
          created_at?: string
          delivery_id: string
          driver_id: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          idempotency_key?: string | null
          updated_at?: string
          vehicle_id: string
          version?: number
        }
        Update: {
          assigned_at?: string
          assigned_by?: string
          assignment_state?: string
          created_at?: string
          delivery_id?: string
          driver_id?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          idempotency_key?: string | null
          updated_at?: string
          vehicle_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "couranr_asg_delivery_fk"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_asg_driver_fk"
            columns: ["driver_id"]
            isOneToOne: false
            referencedRelation: "couranr_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_asg_vehicle_fk"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "couranr_dispatch_vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_delivery_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          command: string
          created_at: string
          delivery_id: string
          from_state: string | null
          id: string
          metadata: Json
          to_state: string | null
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          command: string
          created_at?: string
          delivery_id: string
          from_state?: string | null
          id?: string
          metadata?: Json
          to_state?: string | null
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          command?: string
          created_at?: string
          delivery_id?: string
          from_state?: string | null
          id?: string
          metadata?: Json
          to_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_dlve_delivery_fk"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_delivery_proofs: {
        Row: {
          actor_driver_id: string
          assignment_id: string
          byte_size: number | null
          captured_accuracy_m: number | null
          captured_latitude: number | null
          captured_longitude: number | null
          created_at: string
          delivery_id: string
          discrepancy_id: string | null
          finalized_at: string
          id: string
          metadata: Json
          mime_type: string | null
          proof_stage: string
          proof_type: string
          storage_bucket: string | null
          storage_object_path: string | null
        }
        Insert: {
          actor_driver_id: string
          assignment_id: string
          byte_size?: number | null
          captured_accuracy_m?: number | null
          captured_latitude?: number | null
          captured_longitude?: number | null
          created_at?: string
          delivery_id: string
          discrepancy_id?: string | null
          finalized_at?: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          proof_stage: string
          proof_type: string
          storage_bucket?: string | null
          storage_object_path?: string | null
        }
        Update: {
          actor_driver_id?: string
          assignment_id?: string
          byte_size?: number | null
          captured_accuracy_m?: number | null
          captured_latitude?: number | null
          captured_longitude?: number | null
          created_at?: string
          delivery_id?: string
          discrepancy_id?: string | null
          finalized_at?: string
          id?: string
          metadata?: Json
          mime_type?: string | null
          proof_stage?: string
          proof_type?: string
          storage_bucket?: string | null
          storage_object_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_delivery_proofs_actor_driver_id_fkey"
            columns: ["actor_driver_id"]
            isOneToOne: false
            referencedRelation: "couranr_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_delivery_proofs_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_delivery_proofs_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_dp_discrepancy_fk"
            columns: ["discrepancy_id"]
            isOneToOne: false
            referencedRelation: "couranr_pickup_discrepancies"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_delivery_request_events: {
        Row: {
          actor_type: string
          actor_user_id: string | null
          command: string
          created_at: string
          from_state: string | null
          id: string
          metadata: Json
          request_id: string
          to_state: string | null
        }
        Insert: {
          actor_type: string
          actor_user_id?: string | null
          command: string
          created_at?: string
          from_state?: string | null
          id?: string
          metadata?: Json
          request_id: string
          to_state?: string | null
        }
        Update: {
          actor_type?: string
          actor_user_id?: string | null
          command?: string
          created_at?: string
          from_state?: string | null
          id?: string
          metadata?: Json
          request_id?: string
          to_state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_dre_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_delivery_requests: {
        Row: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string | null
          consumer_contact_snapshot: Json
          created_at: string
          created_by: string | null
          current_quote_version_id: string | null
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          idempotency_scope: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          preset_id: string | null
          preset_snapshot: Json | null
          preset_source: string | null
          preset_version: number | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          requester_kind: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          single_destination_contract: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        Insert: {
          additional_stops?: number
          billable_loaded_miles?: number | null
          business_account_id?: string | null
          consumer_contact_snapshot?: Json
          created_at?: string
          created_by?: string | null
          current_quote_version_id?: string | null
          delivery_subtotal_cents?: number | null
          dropoff_address?: Json | null
          id?: string
          idempotency_key: string
          idempotency_scope: string
          included_loaded_miles?: number | null
          loaded_miles?: number | null
          normalized_request_payload?: Json
          payer_type?: string
          payment_due_cents?: number | null
          pickup_address?: Json | null
          preset_id?: string | null
          preset_snapshot?: Json | null
          preset_source?: string | null
          preset_version?: number | null
          pricing_policy_version?: string | null
          proof_method?: string
          quote_line_items?: Json
          quote_status?: string
          readiness_state?: string
          recipient_email?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          request_state?: string
          requester_kind?: string
          review_reasons?: Json
          review_state?: string
          rounding_applied?: boolean
          service_area_review_state?: string
          service_level?: string
          signature_required?: boolean
          single_destination_contract?: boolean
          source?: string
          submitted_at?: string | null
          tax_included?: boolean
          updated_at?: string
          version?: number
          weight_lb?: number | null
        }
        Update: {
          additional_stops?: number
          billable_loaded_miles?: number | null
          business_account_id?: string | null
          consumer_contact_snapshot?: Json
          created_at?: string
          created_by?: string | null
          current_quote_version_id?: string | null
          delivery_subtotal_cents?: number | null
          dropoff_address?: Json | null
          id?: string
          idempotency_key?: string
          idempotency_scope?: string
          included_loaded_miles?: number | null
          loaded_miles?: number | null
          normalized_request_payload?: Json
          payer_type?: string
          payment_due_cents?: number | null
          pickup_address?: Json | null
          preset_id?: string | null
          preset_snapshot?: Json | null
          preset_source?: string | null
          preset_version?: number | null
          pricing_policy_version?: string | null
          proof_method?: string
          quote_line_items?: Json
          quote_status?: string
          readiness_state?: string
          recipient_email?: string | null
          recipient_name?: string | null
          recipient_phone?: string | null
          request_state?: string
          requester_kind?: string
          review_reasons?: Json
          review_state?: string
          rounding_applied?: boolean
          service_area_review_state?: string
          service_level?: string
          signature_required?: boolean
          single_destination_contract?: boolean
          source?: string
          submitted_at?: string | null
          tax_included?: boolean
          updated_at?: string
          version?: number
          weight_lb?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_dr_current_quote_request_fk"
            columns: ["current_quote_version_id", "id"]
            isOneToOne: false
            referencedRelation: "couranr_quote_versions"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "couranr_delivery_requests_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_delivery_requests_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_dispatch_vehicles: {
        Row: {
          active: boolean
          assigned_driver_id: string | null
          availability_state: string
          cargo_height_in: number | null
          cargo_length_in: number | null
          cargo_width_in: number | null
          created_at: string
          enclosed: boolean
          has_dolly: boolean
          has_ramp: boolean
          has_tie_downs: boolean
          id: string
          name: string
          payload_capacity_lb: number
          updated_at: string
          vehicle_class: string
          version: number
          weather_protection: boolean
        }
        Insert: {
          active?: boolean
          assigned_driver_id?: string | null
          availability_state?: string
          cargo_height_in?: number | null
          cargo_length_in?: number | null
          cargo_width_in?: number | null
          created_at?: string
          enclosed?: boolean
          has_dolly?: boolean
          has_ramp?: boolean
          has_tie_downs?: boolean
          id?: string
          name: string
          payload_capacity_lb: number
          updated_at?: string
          vehicle_class: string
          version?: number
          weather_protection?: boolean
        }
        Update: {
          active?: boolean
          assigned_driver_id?: string | null
          availability_state?: string
          cargo_height_in?: number | null
          cargo_length_in?: number | null
          cargo_width_in?: number | null
          created_at?: string
          enclosed?: boolean
          has_dolly?: boolean
          has_ramp?: boolean
          has_tie_downs?: boolean
          id?: string
          name?: string
          payload_capacity_lb?: number
          updated_at?: string
          vehicle_class?: string
          version?: number
          weather_protection?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "couranr_dv_driver_fk"
            columns: ["assigned_driver_id"]
            isOneToOne: false
            referencedRelation: "couranr_drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_drivers: {
        Row: {
          active: boolean
          availability_state: string
          availability_preference: string
          contact_phone: string | null
          created_at: string
          display_name: string
          driver_state: string
          id: string
          market: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          active?: boolean
          availability_state?: string
          availability_preference?: string
          contact_phone?: string | null
          created_at?: string
          display_name: string
          driver_state?: string
          id?: string
          market?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          active?: boolean
          availability_state?: string
          availability_preference?: string
          contact_phone?: string | null
          created_at?: string
          display_name?: string
          driver_state?: string
          id?: string
          market?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      couranr_handoff_codes: {
        Row: {
          code_digest: string
          code_kind: string
          code_state: string
          consumed_at: string | null
          created_at: string
          delivery_id: string
          expires_at: string
          failed_attempts: number
          generation: number
          id: string
          issued_at: string
          issued_by: string
          last_attempt_at: string | null
          locked_at: string | null
          superseded_at: string | null
          updated_at: string
          version: number
        }
        Insert: {
          code_digest: string
          code_kind: string
          code_state?: string
          consumed_at?: string | null
          created_at?: string
          delivery_id: string
          expires_at: string
          failed_attempts?: number
          generation: number
          id?: string
          issued_at?: string
          issued_by: string
          last_attempt_at?: string | null
          locked_at?: string | null
          superseded_at?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          code_digest?: string
          code_kind?: string
          code_state?: string
          consumed_at?: string | null
          created_at?: string
          delivery_id?: string
          expires_at?: string
          failed_attempts?: number
          generation?: number
          id?: string
          issued_at?: string
          issued_by?: string
          last_attempt_at?: string | null
          locked_at?: string | null
          superseded_at?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "couranr_handoff_codes_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_handoff_records: {
        Row: {
          accuracy_m: number | null
          actor_driver_id: string
          assignment_id: string
          confirmed_vehicle_id: string | null
          counterparty_first_name: string | null
          created_at: string
          delivery_id: string
          dimensions: Json | null
          driver_acknowledged: boolean | null
          existing_damage_statement: string | null
          handoff_stage: string
          id: string
          large_or_unusual: boolean
          latitude: number | null
          loading_equipment: string | null
          loading_participants: string | null
          longitude: number | null
          observed_package_count: number | null
          proof_method_used: string | null
          recorded_at: string
          safe_location_confirmed: boolean | null
          weather_suitable_confirmed: boolean | null
        }
        Insert: {
          accuracy_m?: number | null
          actor_driver_id: string
          assignment_id: string
          confirmed_vehicle_id?: string | null
          counterparty_first_name?: string | null
          created_at?: string
          delivery_id: string
          dimensions?: Json | null
          driver_acknowledged?: boolean | null
          existing_damage_statement?: string | null
          handoff_stage: string
          id?: string
          large_or_unusual?: boolean
          latitude?: number | null
          loading_equipment?: string | null
          loading_participants?: string | null
          longitude?: number | null
          observed_package_count?: number | null
          proof_method_used?: string | null
          recorded_at?: string
          safe_location_confirmed?: boolean | null
          weather_suitable_confirmed?: boolean | null
        }
        Update: {
          accuracy_m?: number | null
          actor_driver_id?: string
          assignment_id?: string
          confirmed_vehicle_id?: string | null
          counterparty_first_name?: string | null
          created_at?: string
          delivery_id?: string
          dimensions?: Json | null
          driver_acknowledged?: boolean | null
          existing_damage_statement?: string | null
          handoff_stage?: string
          id?: string
          large_or_unusual?: boolean
          latitude?: number | null
          loading_equipment?: string | null
          loading_participants?: string | null
          longitude?: number | null
          observed_package_count?: number | null
          proof_method_used?: string | null
          recorded_at?: string
          safe_location_confirmed?: boolean | null
          weather_suitable_confirmed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_handoff_records_actor_driver_id_fkey"
            columns: ["actor_driver_id"]
            isOneToOne: false
            referencedRelation: "couranr_drivers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_handoff_records_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_handoff_records_confirmed_vehicle_id_fkey"
            columns: ["confirmed_vehicle_id"]
            isOneToOne: false
            referencedRelation: "couranr_dispatch_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_handoff_records_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_help_access_tokens: {
        Row: {
          business_account_id: string
          delivery_id: string
          expires_at: string
          id: string
          issued_at: string
          last_used_at: string | null
          revoked_at: string | null
          token_hash: string
        }
        Insert: {
          business_account_id: string
          delivery_id: string
          expires_at: string
          id?: string
          issued_at?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash: string
        }
        Update: {
          business_account_id?: string
          delivery_id?: string
          expires_at?: string
          id?: string
          issued_at?: string
          last_used_at?: string | null
          revoked_at?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "couranr_help_access_tokens_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_help_access_tokens_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_help_access_tokens_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_merchant_workspaces: {
        Row: {
          business_account_id: string
          business_category: string
          contact_phone: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          payer_default: string
          pickup_address: Json
          policies_accepted_at: string
          policies_version: string
          updated_at: string
        }
        Insert: {
          business_account_id: string
          business_category: string
          contact_phone: string
          created_at?: string
          created_by: string
          id?: string
          idempotency_key: string
          payer_default: string
          pickup_address: Json
          policies_accepted_at: string
          policies_version: string
          updated_at?: string
        }
        Update: {
          business_account_id?: string
          business_category?: string
          contact_phone?: string
          created_at?: string
          created_by?: string
          id?: string
          idempotency_key?: string
          payer_default?: string
          pickup_address?: Json
          policies_accepted_at?: string
          policies_version?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "couranr_mw_account_fk"
            columns: ["business_account_id"]
            isOneToOne: true
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_mw_account_fk"
            columns: ["business_account_id"]
            isOneToOne: true
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_payment_access_tokens: {
        Row: {
          action: string
          business_account_id: string | null
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          obligation_id: string | null
          request_id: string
          revoked_at: string | null
          revoked_reason: string | null
          token_hash: string
        }
        Insert: {
          action?: string
          business_account_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          last_used_at?: string | null
          obligation_id?: string | null
          request_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          token_hash: string
        }
        Update: {
          action?: string
          business_account_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_used_at?: string | null
          obligation_id?: string | null
          request_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "couranr_pat_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_pat_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_pat_obligation_fk"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "couranr_payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_pat_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_payment_events: {
        Row: {
          created_at: string
          detail: Json
          event_type: string
          id: string
          obligation_id: string | null
          outcome: string
          payment_state_after: string | null
          payment_state_before: string | null
          provider: string
          provider_event_id: string
          request_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          event_type: string
          id?: string
          obligation_id?: string | null
          outcome: string
          payment_state_after?: string | null
          payment_state_before?: string | null
          provider?: string
          provider_event_id: string
          request_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          event_type?: string
          id?: string
          obligation_id?: string | null
          outcome?: string
          payment_state_after?: string | null
          payment_state_before?: string | null
          provider?: string
          provider_event_id?: string
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_pe_obligation_fk"
            columns: ["obligation_id"]
            isOneToOne: false
            referencedRelation: "couranr_payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_pe_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_payment_obligations: {
        Row: {
          amount_cents: number
          authorized_at: string | null
          business_account_id: string | null
          cancelled_at: string | null
          capture_requested_at: string | null
          captured_amount_cents: number | null
          captured_at: string | null
          created_at: string
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string
          payer_type: string
          payment_state: string
          pricing_policy_version: string
          provider: string
          provider_payment_intent_id: string | null
          quote_version_id: string
          request_id: string
          request_version: number
          updated_at: string
          version: number
        }
        Insert: {
          amount_cents: number
          authorized_at?: string | null
          business_account_id?: string | null
          cancelled_at?: string | null
          capture_requested_at?: string | null
          captured_amount_cents?: number | null
          captured_at?: string | null
          created_at?: string
          currency?: string
          failed_at?: string | null
          id?: string
          idempotency_key: string
          payer_type: string
          payment_state?: string
          pricing_policy_version: string
          provider?: string
          provider_payment_intent_id?: string | null
          quote_version_id: string
          request_id: string
          request_version: number
          updated_at?: string
          version?: number
        }
        Update: {
          amount_cents?: number
          authorized_at?: string | null
          business_account_id?: string | null
          cancelled_at?: string | null
          capture_requested_at?: string | null
          captured_amount_cents?: number | null
          captured_at?: string | null
          created_at?: string
          currency?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          payer_type?: string
          payment_state?: string
          pricing_policy_version?: string
          provider?: string
          provider_payment_intent_id?: string | null
          quote_version_id?: string
          request_id?: string
          request_version?: number
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "couranr_po_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_po_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_po_quote_request_fk"
            columns: ["quote_version_id", "request_id"]
            isOneToOne: false
            referencedRelation: "couranr_quote_versions"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "couranr_po_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_pickup_discrepancies: {
        Row: {
          assignment_id: string
          created_at: string
          delivery_id: string
          discrepancy_state: string
          id: string
          notes: string | null
          reason: string
          reported_at: string
          reported_by_driver_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string
          version: number
        }
        Insert: {
          assignment_id: string
          created_at?: string
          delivery_id: string
          discrepancy_state?: string
          id?: string
          notes?: string | null
          reason: string
          reported_at?: string
          reported_by_driver_id: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          assignment_id?: string
          created_at?: string
          delivery_id?: string
          discrepancy_state?: string
          id?: string
          notes?: string | null
          reason?: string
          reported_at?: string
          reported_by_driver_id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "couranr_pickup_discrepancies_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_pickup_discrepancies_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_pickup_discrepancies_reported_by_driver_id_fkey"
            columns: ["reported_by_driver_id"]
            isOneToOne: false
            referencedRelation: "couranr_drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_proof_uploads: {
        Row: {
          assignment_id: string
          assignment_version: number
          consumed_at: string | null
          created_at: string
          delivery_id: string
          expected_bytes: number
          expected_mime: string
          expires_at: string
          finalized_at: string | null
          id: string
          issued_at: string
          issued_to_driver: string
          object_path: string
          proof_stage: string
          proof_type: string
          storage_bucket: string
          updated_at: string
          upload_nonce: string
          upload_state: string
          version: number
        }
        Insert: {
          assignment_id: string
          assignment_version: number
          consumed_at?: string | null
          created_at?: string
          delivery_id: string
          expected_bytes: number
          expected_mime: string
          expires_at: string
          finalized_at?: string | null
          id?: string
          issued_at?: string
          issued_to_driver: string
          object_path: string
          proof_stage: string
          proof_type: string
          storage_bucket: string
          updated_at?: string
          upload_nonce: string
          upload_state?: string
          version?: number
        }
        Update: {
          assignment_id?: string
          assignment_version?: number
          consumed_at?: string | null
          created_at?: string
          delivery_id?: string
          expected_bytes?: number
          expected_mime?: string
          expires_at?: string
          finalized_at?: string | null
          id?: string
          issued_at?: string
          issued_to_driver?: string
          object_path?: string
          proof_stage?: string
          proof_type?: string
          storage_bucket?: string
          updated_at?: string
          upload_nonce?: string
          upload_state?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "couranr_proof_uploads_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_proof_uploads_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "couranr_deliveries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_proof_uploads_issued_to_driver_fkey"
            columns: ["issued_to_driver"]
            isOneToOne: false
            referencedRelation: "couranr_drivers"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_quote_versions: {
        Row: {
          billable_loaded_miles: number | null
          created_at: string
          created_by_user_id: string | null
          currency: string
          distance_source: string | null
          dropoff_address_snapshot: Json | null
          id: string
          included_loaded_miles: number | null
          legacy_evidence: Json | null
          loaded_distance_miles: number | null
          payer_type: string
          pickup_address_snapshot: Json | null
          pricing_policy_version: string | null
          provenance_state: string
          quote_line_items: Json | null
          quote_number: number
          quote_status: string
          recipient_snapshot: Json | null
          record_origin: string
          request_id: string
          request_version_at_creation: number
          review_reasons: Json
          route_duration_seconds: number | null
          service_configuration_snapshot: Json | null
          shipment_snapshot: Json | null
          subtotal_cents: number | null
          supersedes_quote_version_id: string | null
        }
        Insert: {
          billable_loaded_miles?: number | null
          created_at?: string
          created_by_user_id?: string | null
          currency?: string
          distance_source?: string | null
          dropoff_address_snapshot?: Json | null
          id?: string
          included_loaded_miles?: number | null
          legacy_evidence?: Json | null
          loaded_distance_miles?: number | null
          payer_type: string
          pickup_address_snapshot?: Json | null
          pricing_policy_version?: string | null
          provenance_state: string
          quote_line_items?: Json | null
          quote_number: number
          quote_status: string
          recipient_snapshot?: Json | null
          record_origin: string
          request_id: string
          request_version_at_creation: number
          review_reasons?: Json
          route_duration_seconds?: number | null
          service_configuration_snapshot?: Json | null
          shipment_snapshot?: Json | null
          subtotal_cents?: number | null
          supersedes_quote_version_id?: string | null
        }
        Update: {
          billable_loaded_miles?: number | null
          created_at?: string
          created_by_user_id?: string | null
          currency?: string
          distance_source?: string | null
          dropoff_address_snapshot?: Json | null
          id?: string
          included_loaded_miles?: number | null
          legacy_evidence?: Json | null
          loaded_distance_miles?: number | null
          payer_type?: string
          pickup_address_snapshot?: Json | null
          pricing_policy_version?: string | null
          provenance_state?: string
          quote_line_items?: Json | null
          quote_number?: number
          quote_status?: string
          recipient_snapshot?: Json | null
          record_origin?: string
          request_id?: string
          request_version_at_creation?: number
          review_reasons?: Json
          route_duration_seconds?: number | null
          service_configuration_snapshot?: Json | null
          shipment_snapshot?: Json | null
          subtotal_cents?: number | null
          supersedes_quote_version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "couranr_qv_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_qv_supersedes_fk"
            columns: ["supersedes_quote_version_id"]
            isOneToOne: true
            referencedRelation: "couranr_quote_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      couranr_service_plans: {
        Row: {
          business_account_id: string | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          payment_obligation_id: string
          plan_state: string
          quote_version_id: string
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        Insert: {
          business_account_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          payment_obligation_id: string
          plan_state?: string
          quote_version_id: string
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          timezone: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_requirement: Json
          version?: number
        }
        Update: {
          business_account_id?: string | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          id?: string
          payment_obligation_id?: string
          plan_state?: string
          quote_version_id?: string
          request_id?: string
          request_version?: number
          scheduled_pickup_end?: string
          scheduled_pickup_start?: string
          timezone?: string
          updated_at?: string
          vehicle_id?: string | null
          vehicle_requirement?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "couranr_sp_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "couranr_sp_business_fk"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_sp_dispatch_vehicle_fk"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "couranr_dispatch_vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_sp_obligation_fk"
            columns: ["payment_obligation_id"]
            isOneToOne: false
            referencedRelation: "couranr_payment_obligations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "couranr_sp_quote_request_fk"
            columns: ["quote_version_id", "request_id"]
            isOneToOne: false
            referencedRelation: "couranr_quote_versions"
            referencedColumns: ["id", "request_id"]
          },
          {
            foreignKeyName: "couranr_sp_request_fk"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "couranr_delivery_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      deliveries: {
        Row: {
          base_fee_cents: number | null
          business_account_id: string | null
          business_job_id: string | null
          business_route_template_id: string | null
          business_schedule_id: string | null
          created_at: string | null
          delivery_notes: string | null
          driver_id: string | null
          dropoff_address_id: string | null
          estimated_miles: number | null
          id: string
          mileage_fee_cents: number | null
          order_id: string | null
          pickup_address_id: string | null
          pricing_version: string | null
          recipient_email: string | null
          recipient_name: string
          recipient_phone: string
          rush: boolean | null
          rush_fee_cents: number | null
          scheduled_at: string | null
          signature_fee_cents: number | null
          signature_required: boolean | null
          status: string | null
          stops: number
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          weight_fee_cents: number | null
          weight_lbs: number | null
        }
        Insert: {
          base_fee_cents?: number | null
          business_account_id?: string | null
          business_job_id?: string | null
          business_route_template_id?: string | null
          business_schedule_id?: string | null
          created_at?: string | null
          delivery_notes?: string | null
          driver_id?: string | null
          dropoff_address_id?: string | null
          estimated_miles?: number | null
          id?: string
          mileage_fee_cents?: number | null
          order_id?: string | null
          pickup_address_id?: string | null
          pricing_version?: string | null
          recipient_email?: string | null
          recipient_name: string
          recipient_phone: string
          rush?: boolean | null
          rush_fee_cents?: number | null
          scheduled_at?: string | null
          signature_fee_cents?: number | null
          signature_required?: boolean | null
          status?: string | null
          stops?: number
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          weight_fee_cents?: number | null
          weight_lbs?: number | null
        }
        Update: {
          base_fee_cents?: number | null
          business_account_id?: string | null
          business_job_id?: string | null
          business_route_template_id?: string | null
          business_schedule_id?: string | null
          created_at?: string | null
          delivery_notes?: string | null
          driver_id?: string | null
          dropoff_address_id?: string | null
          estimated_miles?: number | null
          id?: string
          mileage_fee_cents?: number | null
          order_id?: string | null
          pickup_address_id?: string | null
          pricing_version?: string | null
          recipient_email?: string | null
          recipient_name?: string
          recipient_phone?: string
          rush?: boolean | null
          rush_fee_cents?: number | null
          scheduled_at?: string | null
          signature_fee_cents?: number | null
          signature_required?: boolean | null
          status?: string | null
          stops?: number
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          weight_fee_cents?: number | null
          weight_lbs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "deliveries_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "deliveries_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_business_job_id_fkey"
            columns: ["business_job_id"]
            isOneToOne: false
            referencedRelation: "business_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_business_route_template_id_fkey"
            columns: ["business_route_template_id"]
            isOneToOne: false
            referencedRelation: "business_route_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_business_schedule_id_fkey"
            columns: ["business_schedule_id"]
            isOneToOne: false
            referencedRelation: "business_route_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_dropoff_address_id_fkey"
            columns: ["dropoff_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deliveries_pickup_address_id_fkey"
            columns: ["pickup_address_id"]
            isOneToOne: false
            referencedRelation: "addresses"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_admin_events: {
        Row: {
          admin_user_id: string | null
          after_json: Json | null
          before_json: Json | null
          created_at: string
          delivery_id: string
          event_type: string
          id: string
        }
        Insert: {
          admin_user_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          delivery_id: string
          event_type: string
          id?: string
        }
        Update: {
          admin_user_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          delivery_id?: string
          event_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_admin_events_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_photos: {
        Row: {
          created_at: string | null
          delivery_id: string
          id: string
          photo_type: string
          photo_url: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string | null
          delivery_id: string
          id?: string
          photo_type: string
          photo_url: string
          uploaded_by: string
        }
        Update: {
          created_at?: string | null
          delivery_id?: string
          id?: string
          photo_type?: string
          photo_url?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_photos_delivery_id_fkey"
            columns: ["delivery_id"]
            isOneToOne: false
            referencedRelation: "deliveries"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_request_events: {
        Row: {
          actor_role: string
          actor_user_id: string | null
          created_at: string
          event_payload: Json
          event_type: string
          id: string
          request_id: string
        }
        Insert: {
          actor_role: string
          actor_user_id?: string | null
          created_at?: string
          event_payload?: Json
          event_type: string
          id?: string
          request_id: string
        }
        Update: {
          actor_role?: string
          actor_user_id?: string | null
          created_at?: string
          event_payload?: Json
          event_type?: string
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "docs_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "doc_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "docs_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_request_files: {
        Row: {
          created_at: string
          display_name: string | null
          file_name: string
          file_role: string
          id: string
          mime_type: string | null
          original_name: string | null
          request_id: string
          size_bytes: number | null
          storage_bucket: string
          storage_path: string
          storage_url: string
          uploaded_by_role: string
          uploaded_by_user_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          file_name?: string
          file_role: string
          id?: string
          mime_type?: string | null
          original_name?: string | null
          request_id: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          storage_url: string
          uploaded_by_role?: string
          uploaded_by_user_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          file_name?: string
          file_role?: string
          id?: string
          mime_type?: string | null
          original_name?: string | null
          request_id?: string
          size_bytes?: number | null
          storage_bucket?: string
          storage_path?: string
          storage_url?: string
          uploaded_by_role?: string
          uploaded_by_user_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docs_request_files_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "doc_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_request_files_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "docs_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_request_line_items: {
        Row: {
          created_at: string
          id: string
          label: string
          line_total_cents: number
          line_type: string
          position: number
          qty: number
          request_id: string
          unit: string | null
          unit_price_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          line_total_cents?: number
          line_type?: string
          position?: number
          qty?: number
          request_id: string
          unit?: string | null
          unit_price_cents?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          line_total_cents?: number
          line_type?: string
          position?: number
          qty?: number
          request_id?: string
          unit?: string | null
          unit_price_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "docs_request_line_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "doc_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_request_line_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "docs_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_request_notes: {
        Row: {
          author_role: string
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          request_id: string
          visibility: string
        }
        Insert: {
          author_role: string
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          request_id: string
          visibility?: string
        }
        Update: {
          author_role?: string
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          request_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "docs_request_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "doc_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_request_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "docs_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_requests: {
        Row: {
          admin_notes: string | null
          amount_paid_cents: number
          amount_subtotal_cents: number
          business_account_id: string | null
          business_job_id: string | null
          business_name: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          delivered_at: string | null
          delivery_address: string | null
          delivery_fee_cents: number
          delivery_method: string
          description: string | null
          dmv_nonlegal_ack: boolean
          docs_terms_accepted_at: string | null
          docs_terms_version: string | null
          final_total_cents: number | null
          form_payload: Json
          id: string
          immigration_nonlegal_ack: boolean
          intake_notes: string | null
          intake_payload: Json
          out_for_delivery_at: string | null
          paid: boolean
          paid_at: string | null
          payment_status: string
          phone: string | null
          pickup_location: string | null
          quote_approved_at: string | null
          quote_expires_at: string | null
          quote_sent_at: string | null
          quoted_total_cents: number | null
          ready_at: string | null
          request_code: string
          request_no: number
          request_payload: Json
          rush_fee_cents: number
          service_label: string | null
          service_subtype: string | null
          service_type: string
          started_at: string | null
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          submitted_at: string | null
          tax_cents: number
          terms_accepted_at: string | null
          terms_version: string | null
          title: string | null
          total_cents: number
          updated_at: string
          urgency: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          amount_paid_cents?: number
          amount_subtotal_cents?: number
          business_account_id?: string | null
          business_job_id?: string | null
          business_name?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee_cents?: number
          delivery_method?: string
          description?: string | null
          dmv_nonlegal_ack?: boolean
          docs_terms_accepted_at?: string | null
          docs_terms_version?: string | null
          final_total_cents?: number | null
          form_payload?: Json
          id?: string
          immigration_nonlegal_ack?: boolean
          intake_notes?: string | null
          intake_payload?: Json
          out_for_delivery_at?: string | null
          paid?: boolean
          paid_at?: string | null
          payment_status?: string
          phone?: string | null
          pickup_location?: string | null
          quote_approved_at?: string | null
          quote_expires_at?: string | null
          quote_sent_at?: string | null
          quoted_total_cents?: number | null
          ready_at?: string | null
          request_code: string
          request_no?: never
          request_payload?: Json
          rush_fee_cents?: number
          service_label?: string | null
          service_subtype?: string | null
          service_type: string
          started_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          submitted_at?: string | null
          tax_cents?: number
          terms_accepted_at?: string | null
          terms_version?: string | null
          title?: string | null
          total_cents?: number
          updated_at?: string
          urgency?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          amount_paid_cents?: number
          amount_subtotal_cents?: number
          business_account_id?: string | null
          business_job_id?: string | null
          business_name?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee_cents?: number
          delivery_method?: string
          description?: string | null
          dmv_nonlegal_ack?: boolean
          docs_terms_accepted_at?: string | null
          docs_terms_version?: string | null
          final_total_cents?: number | null
          form_payload?: Json
          id?: string
          immigration_nonlegal_ack?: boolean
          intake_notes?: string | null
          intake_payload?: Json
          out_for_delivery_at?: string | null
          paid?: boolean
          paid_at?: string | null
          payment_status?: string
          phone?: string | null
          pickup_location?: string | null
          quote_approved_at?: string | null
          quote_expires_at?: string | null
          quote_sent_at?: string | null
          quoted_total_cents?: number | null
          ready_at?: string | null
          request_code?: string
          request_no?: never
          request_payload?: Json
          rush_fee_cents?: number
          service_label?: string | null
          service_subtype?: string | null
          service_type?: string
          started_at?: string | null
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          submitted_at?: string | null
          tax_cents?: number
          terms_accepted_at?: string | null
          terms_version?: string | null
          title?: string | null
          total_cents?: number
          updated_at?: string
          urgency?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doc_requests_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "doc_requests_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_requests_business_job_id_fkey"
            columns: ["business_job_id"]
            isOneToOne: false
            referencedRelation: "business_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          created_at: string | null
          event_data: Json | null
          event_type: string
          id: string
          order_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_data?: Json | null
          event_type: string
          id?: string
          order_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_data?: Json | null
          event_type?: string
          id?: string
          order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          business_account_id: string | null
          business_job_id: string | null
          created_at: string | null
          currency: string | null
          customer_id: string
          fees_cents: number | null
          id: string
          notes: string | null
          order_number: string
          paid_at: string | null
          payment_status: string
          service_type: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          subtotal_cents: number | null
          total_cents: number | null
          updated_at: string | null
        }
        Insert: {
          business_account_id?: string | null
          business_job_id?: string | null
          created_at?: string | null
          currency?: string | null
          customer_id: string
          fees_cents?: number | null
          id?: string
          notes?: string | null
          order_number?: string
          paid_at?: string | null
          payment_status?: string
          service_type: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number | null
          total_cents?: number | null
          updated_at?: string | null
        }
        Update: {
          business_account_id?: string | null
          business_job_id?: string | null
          created_at?: string | null
          currency?: string | null
          customer_id?: string
          fees_cents?: number | null
          id?: string
          notes?: string | null
          order_number?: string
          paid_at?: string | null
          payment_status?: string
          service_type?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          subtotal_cents?: number | null
          total_cents?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_account_30d_kpis"
            referencedColumns: ["business_account_id"]
          },
          {
            foreignKeyName: "orders_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_business_job_id_fkey"
            columns: ["business_job_id"]
            isOneToOne: false
            referencedRelation: "business_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_authorized_cents: number | null
          amount_captured_cents: number | null
          authorized_at: string | null
          captured_at: string | null
          created_at: string | null
          currency: string | null
          id: string
          order_id: string | null
          payment_intent_id: string | null
          status: string | null
        }
        Insert: {
          amount_authorized_cents?: number | null
          amount_captured_cents?: number | null
          authorized_at?: string | null
          captured_at?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          order_id?: string | null
          payment_intent_id?: string | null
          status?: string | null
        }
        Update: {
          amount_authorized_cents?: number | null
          amount_captured_cents?: number | null
          authorized_at?: string | null
          captured_at?: string | null
          created_at?: string | null
          currency?: string | null
          id?: string
          order_id?: string | null
          payment_intent_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          role: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id: string
          role?: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      proof_media: {
        Row: {
          created_at: string | null
          id: string
          order_id: string | null
          storage_path: string
          type: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id?: string | null
          storage_path: string
          type: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string | null
          storage_path?: string
          type?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proof_media_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_agreements: {
        Row: {
          agreement_url: string | null
          agreement_version: string
          created_at: string
          id: string
          ip_address: string | null
          purpose: string
          rental_id: string
          signed_at: string
          signed_name: string
          signed_text: string | null
        }
        Insert: {
          agreement_url?: string | null
          agreement_version?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          purpose?: string
          rental_id: string
          signed_at?: string
          signed_name: string
          signed_text?: string | null
        }
        Update: {
          agreement_url?: string | null
          agreement_version?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          purpose?: string
          rental_id?: string
          signed_at?: string
          signed_name?: string
          signed_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_agreements_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_condition_photos: {
        Row: {
          captured_accuracy_m: number | null
          captured_at: string
          captured_lat: number | null
          captured_lng: number | null
          created_at: string
          id: string
          phase: string
          photo_url: string
          rental_id: string
          user_id: string
        }
        Insert: {
          captured_accuracy_m?: number | null
          captured_at?: string
          captured_lat?: number | null
          captured_lng?: number | null
          created_at?: string
          id?: string
          phase: string
          photo_url: string
          rental_id: string
          user_id: string
        }
        Update: {
          captured_accuracy_m?: number | null
          captured_at?: string
          captured_lat?: number | null
          captured_lng?: number | null
          created_at?: string
          id?: string
          phase?: string
          photo_url?: string
          rental_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_condition_photos_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_events: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          created_at: string
          event_payload: Json
          event_type: string
          id: string
          rental_id: string
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          event_payload?: Json
          event_type: string
          id?: string
          rental_id: string
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string
          event_payload?: Json
          event_type?: string
          id?: string
          rental_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_events_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_files: {
        Row: {
          created_at: string
          id: string
          kind: string
          rental_id: string
          storage_bucket: string
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          rental_id: string
          storage_bucket?: string
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          rental_id?: string
          storage_bucket?: string
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_files_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          kind: string
          rental_id: string
          status: string
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          kind: string
          rental_id: string
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          kind?: string
          rental_id?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_uploads: {
        Row: {
          created_at: string
          file_url: string
          id: string
          kind: string
          rental_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_url: string
          id?: string
          kind: string
          rental_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_url?: string
          id?: string
          kind?: string
          rental_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_uploads_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_verifications: {
        Row: {
          admin_note: string | null
          admin_status: string
          approved_at: string | null
          approved_by: string | null
          gps_accuracy: number | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          license_back_url: string
          license_front_url: string
          rental_id: string
          selfie_url: string
          uploaded_at: string
        }
        Insert: {
          admin_note?: string | null
          admin_status?: string
          approved_at?: string | null
          approved_by?: string | null
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          license_back_url: string
          license_front_url: string
          rental_id: string
          selfie_url: string
          uploaded_at?: string
        }
        Update: {
          admin_note?: string | null
          admin_status?: string
          approved_at?: string | null
          approved_by?: string | null
          gps_accuracy?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          license_back_url?: string
          license_front_url?: string
          rental_id?: string
          selfie_url?: string
          uploaded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_verifications_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      rentals: {
        Row: {
          agreement_required: boolean
          agreement_signed: boolean
          approval_status: string
          completed_at: string | null
          condition_photos_complete: boolean
          condition_photos_status: string
          created_at: string
          damage_confirmed: boolean
          damage_confirmed_at: string | null
          damage_notes: string | null
          deposit_cents: number
          deposit_refund_amount_cents: number | null
          deposit_refund_status: string
          docs_complete: boolean
          end_date: string
          id: string
          lockbox_code: string | null
          lockbox_code_released_at: string | null
          notes: string | null
          paid: boolean
          paid_at: string | null
          pickup_at: string | null
          pickup_confirmed_at: string | null
          pickup_location: string | null
          pricing_mode: string
          purpose: string
          rate_cents: number
          renter_id: string
          return_at: string | null
          return_confirmed_at: string | null
          start_date: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          user_id: string
          vehicle_id: string
          verification_complete: boolean
          verification_denial_reason: string | null
          verification_status: string
        }
        Insert: {
          agreement_required?: boolean
          agreement_signed?: boolean
          approval_status?: string
          completed_at?: string | null
          condition_photos_complete?: boolean
          condition_photos_status?: string
          created_at?: string
          damage_confirmed?: boolean
          damage_confirmed_at?: string | null
          damage_notes?: string | null
          deposit_cents?: number
          deposit_refund_amount_cents?: number | null
          deposit_refund_status?: string
          docs_complete?: boolean
          end_date: string
          id?: string
          lockbox_code?: string | null
          lockbox_code_released_at?: string | null
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          pickup_at?: string | null
          pickup_confirmed_at?: string | null
          pickup_location?: string | null
          pricing_mode: string
          purpose?: string
          rate_cents: number
          renter_id: string
          return_at?: string | null
          return_confirmed_at?: string | null
          start_date: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          user_id: string
          vehicle_id: string
          verification_complete?: boolean
          verification_denial_reason?: string | null
          verification_status?: string
        }
        Update: {
          agreement_required?: boolean
          agreement_signed?: boolean
          approval_status?: string
          completed_at?: string | null
          condition_photos_complete?: boolean
          condition_photos_status?: string
          created_at?: string
          damage_confirmed?: boolean
          damage_confirmed_at?: string | null
          damage_notes?: string | null
          deposit_cents?: number
          deposit_refund_amount_cents?: number | null
          deposit_refund_status?: string
          docs_complete?: boolean
          end_date?: string
          id?: string
          lockbox_code?: string | null
          lockbox_code_released_at?: string | null
          notes?: string | null
          paid?: boolean
          paid_at?: string | null
          pickup_at?: string | null
          pickup_confirmed_at?: string | null
          pickup_location?: string | null
          pricing_mode?: string
          purpose?: string
          rate_cents?: number
          renter_id?: string
          return_at?: string | null
          return_confirmed_at?: string | null
          start_date?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          user_id?: string
          vehicle_id?: string
          verification_complete?: boolean
          verification_denial_reason?: string | null
          verification_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "rentals_renter_id_fkey"
            columns: ["renter_id"]
            isOneToOne: false
            referencedRelation: "renters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_identity_documents: {
        Row: {
          id: string
          license_back_url: string
          license_front_url: string
          rental_id: string
          uploaded_at: string
          verified: boolean
        }
        Insert: {
          id?: string
          license_back_url: string
          license_front_url: string
          rental_id: string
          uploaded_at?: string
          verified?: boolean
        }
        Update: {
          id?: string
          license_back_url?: string
          license_front_url?: string
          rental_id?: string
          uploaded_at?: string
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "renter_identity_documents_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      renter_verifications: {
        Row: {
          captured_accuracy_m: number | null
          captured_at: string
          captured_lat: number | null
          captured_lng: number | null
          created_at: string
          has_insurance: boolean
          id: string
          license_back_url: string | null
          license_expires: string | null
          license_front_url: string | null
          license_state: string | null
          rental_id: string
          selfie_url: string | null
          user_id: string
        }
        Insert: {
          captured_accuracy_m?: number | null
          captured_at?: string
          captured_lat?: number | null
          captured_lng?: number | null
          created_at?: string
          has_insurance?: boolean
          id?: string
          license_back_url?: string | null
          license_expires?: string | null
          license_front_url?: string | null
          license_state?: string | null
          rental_id: string
          selfie_url?: string | null
          user_id: string
        }
        Update: {
          captured_accuracy_m?: number | null
          captured_at?: string
          captured_lat?: number | null
          captured_lng?: number | null
          created_at?: string
          has_insurance?: boolean
          id?: string
          license_back_url?: string | null
          license_expires?: string | null
          license_front_url?: string | null
          license_state?: string | null
          rental_id?: string
          selfie_url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "renter_verifications_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: true
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
        ]
      }
      renters: {
        Row: {
          address_line: string | null
          city: string | null
          created_at: string
          email: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          full_name: string
          id: string
          license_back_url: string | null
          license_expires: string
          license_front_url: string | null
          license_number: string
          license_state: string
          phone: string
          state: string | null
          user_id: string
          zip: string | null
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          created_at?: string
          email: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name: string
          id?: string
          license_back_url?: string | null
          license_expires: string
          license_front_url?: string | null
          license_number: string
          license_state: string
          phone: string
          state?: string | null
          user_id: string
          zip?: string | null
        }
        Update: {
          address_line?: string | null
          city?: string | null
          created_at?: string
          email?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          full_name?: string
          id?: string
          license_back_url?: string | null
          license_expires?: string
          license_front_url?: string | null
          license_number?: string
          license_state?: string
          phone?: string
          state?: string | null
          user_id?: string
          zip?: string | null
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          event_type: string
          id: number
          livemode: boolean
          payload: Json
          processed_at: string
          stripe_event_id: string
        }
        Insert: {
          event_type: string
          id?: number
          livemode?: boolean
          payload?: Json
          processed_at?: string
          stripe_event_id: string
        }
        Update: {
          event_type?: string
          id?: number
          livemode?: boolean
          payload?: Json
          processed_at?: string
          stripe_event_id?: string
        }
        Relationships: []
      }
      vehicle_maintenance: {
        Row: {
          cost_cents: number | null
          created_at: string
          id: string
          mileage: number | null
          notes: string | null
          service_date: string
          service_type: string
          vehicle_id: string
        }
        Insert: {
          cost_cents?: number | null
          created_at?: string
          id?: string
          mileage?: number | null
          notes?: string | null
          service_date?: string
          service_type: string
          vehicle_id: string
        }
        Update: {
          cost_cents?: number | null
          created_at?: string
          id?: string
          mileage?: number | null
          notes?: string | null
          service_date?: string
          service_type?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_maintenance_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          color: string | null
          created_at: string
          daily_rate_cents: number
          deposit_cents: number
          id: string
          image_urls: string[] | null
          make: string
          mileage: number | null
          model: string
          notes: string | null
          plate: string | null
          status: string
          trim: string | null
          vin: string | null
          weekly_rate_cents: number
          year: number
        }
        Insert: {
          color?: string | null
          created_at?: string
          daily_rate_cents?: number
          deposit_cents?: number
          id?: string
          image_urls?: string[] | null
          make: string
          mileage?: number | null
          model: string
          notes?: string | null
          plate?: string | null
          status?: string
          trim?: string | null
          vin?: string | null
          weekly_rate_cents?: number
          year: number
        }
        Update: {
          color?: string | null
          created_at?: string
          daily_rate_cents?: number
          deposit_cents?: number
          id?: string
          image_urls?: string[] | null
          make?: string
          mileage?: number | null
          model?: string
          notes?: string | null
          plate?: string | null
          status?: string
          trim?: string | null
          vin?: string | null
          weekly_rate_cents?: number
          year?: number
        }
        Relationships: []
      }
    }
    Views: {
      business_account_30d_kpis: {
        Row: {
          business_account_id: string | null
          business_account_name: string | null
          deliveries_30d: number | null
          docs_requests_30d: number | null
          order_revenue_cents_30d: number | null
        }
        Relationships: []
      }
      docs_request_events: {
        Row: {
          actor_role: string | null
          actor_user_id: string | null
          created_at: string | null
          event_payload: Json | null
          event_type: string | null
          id: string | null
          request_id: string | null
        }
        Insert: {
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string | null
          event_payload?: Json | null
          event_type?: string | null
          id?: string | null
          request_id?: string | null
        }
        Update: {
          actor_role?: string | null
          actor_user_id?: string | null
          created_at?: string | null
          event_payload?: Json | null
          event_type?: string | null
          id?: string | null
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docs_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "doc_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "docs_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      docs_request_files: {
        Row: {
          created_at: string | null
          file_role: string | null
          id: string | null
          mime_type: string | null
          original_name: string | null
          request_id: string | null
          size_bytes: number | null
          storage_url: string | null
          uploaded_by_role: string | null
          uploaded_by_user_id: string | null
        }
        Insert: {
          created_at?: string | null
          file_role?: string | null
          id?: string | null
          mime_type?: string | null
          original_name?: string | null
          request_id?: string | null
          size_bytes?: number | null
          storage_url?: string | null
          uploaded_by_role?: string | null
          uploaded_by_user_id?: string | null
        }
        Update: {
          created_at?: string | null
          file_role?: string | null
          id?: string | null
          mime_type?: string | null
          original_name?: string | null
          request_id?: string | null
          size_bytes?: number | null
          storage_url?: string | null
          uploaded_by_role?: string | null
          uploaded_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docs_request_files_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "doc_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_request_files_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "docs_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      docs_request_line_items: {
        Row: {
          created_at: string | null
          id: string | null
          label: string | null
          line_total_cents: number | null
          line_type: string | null
          position: number | null
          qty: number | null
          request_id: string | null
          unit: string | null
          unit_price_cents: number | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          label?: string | null
          line_total_cents?: number | null
          line_type?: string | null
          position?: number | null
          qty?: number | null
          request_id?: string | null
          unit?: string | null
          unit_price_cents?: number | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          label?: string | null
          line_total_cents?: number | null
          line_type?: string | null
          position?: number | null
          qty?: number | null
          request_id?: string | null
          unit?: string | null
          unit_price_cents?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docs_request_line_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "doc_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_request_line_items_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "docs_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      docs_request_notes: {
        Row: {
          author_role: string | null
          author_user_id: string | null
          body: string | null
          created_at: string | null
          id: string | null
          request_id: string | null
          visibility: string | null
        }
        Insert: {
          author_role?: string | null
          author_user_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string | null
          request_id?: string | null
          visibility?: string | null
        }
        Update: {
          author_role?: string | null
          author_user_id?: string | null
          body?: string | null
          created_at?: string | null
          id?: string | null
          request_id?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "docs_request_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "doc_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_request_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "docs_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      docs_requests: {
        Row: {
          admin_notes: string | null
          amount_paid_cents: number | null
          amount_subtotal_cents: number | null
          business_name: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          created_at: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          delivered_at: string | null
          delivery_address: string | null
          delivery_fee_cents: number | null
          delivery_method: string | null
          dmv_nonlegal_ack: boolean | null
          id: string | null
          immigration_nonlegal_ack: boolean | null
          intake_notes: string | null
          out_for_delivery_at: string | null
          paid: boolean | null
          paid_at: string | null
          payment_status: string | null
          pickup_location: string | null
          quote_approved_at: string | null
          quote_expires_at: string | null
          quote_sent_at: string | null
          ready_at: string | null
          request_code: string | null
          request_no: number | null
          rush_fee_cents: number | null
          service_subtype: string | null
          service_type: string | null
          started_at: string | null
          status: string | null
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          tax_cents: number | null
          title: string | null
          total_cents: number | null
          updated_at: string | null
          urgency: string | null
          user_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          amount_paid_cents?: number | null
          amount_subtotal_cents?: number | null
          business_name?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee_cents?: number | null
          delivery_method?: string | null
          dmv_nonlegal_ack?: boolean | null
          id?: string | null
          immigration_nonlegal_ack?: boolean | null
          intake_notes?: string | null
          out_for_delivery_at?: string | null
          paid?: boolean | null
          paid_at?: string | null
          payment_status?: string | null
          pickup_location?: string | null
          quote_approved_at?: string | null
          quote_expires_at?: string | null
          quote_sent_at?: string | null
          ready_at?: string | null
          request_code?: string | null
          request_no?: number | null
          rush_fee_cents?: number | null
          service_subtype?: string | null
          service_type?: string | null
          started_at?: string | null
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number | null
          title?: string | null
          total_cents?: number | null
          updated_at?: string | null
          urgency?: string | null
          user_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          amount_paid_cents?: number | null
          amount_subtotal_cents?: number | null
          business_name?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          delivered_at?: string | null
          delivery_address?: string | null
          delivery_fee_cents?: number | null
          delivery_method?: string | null
          dmv_nonlegal_ack?: boolean | null
          id?: string | null
          immigration_nonlegal_ack?: boolean | null
          intake_notes?: string | null
          out_for_delivery_at?: string | null
          paid?: boolean | null
          paid_at?: string | null
          payment_status?: string | null
          pickup_location?: string | null
          quote_approved_at?: string | null
          quote_expires_at?: string | null
          quote_sent_at?: string | null
          ready_at?: string | null
          request_code?: string | null
          request_no?: number | null
          rush_fee_cents?: number | null
          service_subtype?: string | null
          service_type?: string | null
          started_at?: string | null
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          tax_cents?: number | null
          title?: string | null
          total_cents?: number | null
          updated_at?: string | null
          urgency?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      app_is_admin: { Args: never; Returns: boolean }
      app_is_business_member: {
        Args: { p_business_account_id: string }
        Returns: boolean
      }
      couranr_accept_delivery_request_as_quoted: {
        Args: {
          p_actor_user_id: string
          p_business_account_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_activate_driver: {
        Args: {
          p_actor_user_id: string
          p_driver_id: string
          p_expected_version: number
        }
        Returns: {
          active: boolean
          availability_state: string
          contact_phone: string | null
          created_at: string
          display_name: string
          driver_state: string
          id: string
          market: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_add_operating_minutes: {
        Args: { p_from: string; p_minutes: number }
        Returns: string
      }
      couranr_apply_payment_intent_state: {
        Args: {
          p_amount: number
          p_amount_capturable: number
          p_currency: string
          p_event_type: string
          p_intent_status: string
          p_metadata: Json
          p_payment_intent_id: string
          p_provider_event_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["couranr_payment_apply_result"]
        SetofOptions: {
          from: "*"
          to: "couranr_payment_apply_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_apply_readiness: {
        Args: {
          p_actor_user_id: string
          p_business_account_id: string
          p_command: string
          p_expected_version: number
          p_from: string[]
          p_request_id: string
          p_to: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_arrive_at_dropoff: {
        Args: {
          p_accuracy_m: number
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_version: number
          p_latitude: number
          p_longitude: number
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_arrive_at_pickup: {
        Args: {
          p_accuracy_m: number
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_version: number
          p_latitude: number
          p_longitude: number
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_assert_driver_mutable: {
        Args: { p_driver_id: string }
        Returns: {
          active: boolean
          availability_state: string
          contact_phone: string | null
          created_at: string
          display_name: string
          driver_state: string
          id: string
          market: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_assert_dropoff_ready: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_latitude: number
          p_longitude: number
          p_proof_method: string
        }
        Returns: {
          assigned_at: string
          assigned_by: string
          assignment_state: string
          created_at: string
          delivery_id: string
          driver_id: string
          end_reason: string | null
          ended_at: string | null
          id: string
          idempotency_key: string | null
          updated_at: string
          vehicle_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_assert_readiness_mutable: {
        Args: { p_request_id: string }
        Returns: undefined
      }
      couranr_assign_delivery: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_driver_id: string
          p_expected_version: number
          p_idempotency_key: string
          p_vehicle_id: string
        }
        Returns: {
          assigned_at: string
          assigned_by: string
          assignment_state: string
          created_at: string
          delivery_id: string
          driver_id: string
          end_reason: string | null
          ended_at: string | null
          id: string
          idempotency_key: string | null
          updated_at: string
          vehicle_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_attach_payment_intent: {
        Args: {
          p_expected_version: number
          p_obligation_id: string
          p_payment_intent_id: string
        }
        Returns: {
          amount_cents: number
          authorized_at: string | null
          business_account_id: string
          cancelled_at: string | null
          capture_requested_at: string | null
          captured_amount_cents: number | null
          captured_at: string | null
          created_at: string
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string
          payer_type: string
          payment_state: string
          pricing_policy_version: string
          provider: string
          provider_payment_intent_id: string | null
          request_id: string
          request_version: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_payment_obligations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_begin_delivery_preparation: {
        Args: {
          p_actor_user_id: string
          p_business_account_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_begin_delivery_request_review: {
        Args: {
          p_actor_user_id: string
          p_business_account_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_begin_payment_capture: {
        Args: { p_actor_user_id: string; p_request_id: string }
        Returns: {
          amount_cents: number
          authorized_at: string | null
          business_account_id: string
          cancelled_at: string | null
          capture_requested_at: string | null
          captured_amount_cents: number | null
          captured_at: string | null
          created_at: string
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string
          payer_type: string
          payment_state: string
          pricing_policy_version: string
          provider: string
          provider_payment_intent_id: string | null
          request_id: string
          request_version: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_payment_obligations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_calculate_delivery_request_estimate: {
        Args: {
          p_actor_user_id: string
          p_additional_stops: number
          p_billable_loaded_miles: number
          p_business_account_id: string
          p_delivery_subtotal_cents: number
          p_dropoff_address: Json
          p_expected_version: number
          p_included_loaded_miles: number
          p_loaded_miles: number
          p_overnight_requested: boolean
          p_payer_type: string
          p_pickup_address: Json
          p_pricing_policy_version: string
          p_proof_method: string
          p_quote_line_items: Json
          p_quote_status: string
          p_readiness_state: string
          p_recipient_email: string
          p_recipient_name: string
          p_recipient_phone: string
          p_request_id: string
          p_review_reasons: Json
          p_service_level: string
          p_signature_required: boolean
          p_source: string
          p_update_shipment: boolean
          p_weight_lb: number
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_cancel_service_plan: {
        Args: { p_reason: string; p_request_id: string }
        Returns: number
      }
      couranr_complete_direct_handoff_delivery: {
        Args: {
          p_accuracy_m: number
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_version: number
          p_latitude: number
          p_longitude: number
          p_recipient_first_name: string
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_complete_leave_at_door_delivery: {
        Args: {
          p_accuracy_m: number
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_version: number
          p_latitude: number
          p_longitude: number
          p_safe_location: boolean
          p_weather_suitable: boolean
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_complete_payment_capture: {
        Args: {
          p_amount_received: number
          p_currency: string
          p_intent_status: string
          p_obligation_id: string
          p_payment_intent_id: string
          p_provider_event_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["couranr_payment_apply_result"]
        SetofOptions: {
          from: "*"
          to: "couranr_payment_apply_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_complete_pickup: {
        Args: {
          p_accuracy_m: number
          p_actor_user_id: string
          p_confirmed_vehicle_id: string
          p_delivery_id: string
          p_dimensions: Json
          p_driver_acknowledged: boolean
          p_existing_damage: string
          p_expected_version: number
          p_latitude: number
          p_loading_equipment: string
          p_loading_participants: string
          p_longitude: number
          p_observed_package_count: number
          p_staff_first_name: string
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_complete_signature_delivery: {
        Args: {
          p_accuracy_m: number
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_version: number
          p_latitude: number
          p_longitude: number
          p_signer_first_name: string
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_confirm_service_plan: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_pickup_end: string
          p_pickup_start: string
          p_request_id: string
          p_timezone: string
          p_vehicle_id: string
          p_vehicle_requirement: Json
        }
        Returns: {
          business_account_id: string
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          id: string
          payment_obligation_id: string
          plan_state: string
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_service_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_conversation_thread: {
        Args: { p_conversation_id: string; p_viewer_user_id: string }
        Returns: {
          author_participant_id: string | null
          author_user_id: string | null
          authorship: string
          body: string
          conversation_id: string
          created_at: string
          id: string
          idempotency_key: string
          topic: string | null
          visibility: string
        }[]
        SetofOptions: {
          from: "*"
          to: "couranr_conversation_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      couranr_operations_conversation_thread: {
        Args: { p_actor_user_id: string; p_conversation_id: string }
        Returns: {
          author_participant_id: string | null
          author_user_id: string | null
          authorship: string
          body: string
          conversation_id: string
          created_at: string
          id: string
          idempotency_key: string
          topic: string | null
          visibility: string
        }[]
        SetofOptions: {
          from: "*"
          to: "couranr_conversation_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      couranr_ensure_delivery_chat: {
        Args: { p_delivery_id: string }
        Returns: string
      }
      couranr_join_assignment_delivery_chat: {
        Args: { p_delivery_id: string; p_driver_id: string }
        Returns: string
      }
      couranr_leave_assignment_delivery_chat: {
        Args: {
          p_delivery_id: string
          p_driver_id: string
          p_left_at?: string
        }
        Returns: number
      }
      couranr_reconcile_delivery_chats: {
        Args: Record<PropertyKey, never>
        Returns: {
          active_drivers_checked: number
          deliveries_checked: number
        }[]
      }
      couranr_create_delivery_from_capture: {
        Args: { p_request_id: string }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_create_delivery_request_draft: {
        Args: {
          p_additional_stops: number
          p_billable_loaded_miles: number
          p_business_account_id: string
          p_created_by: string
          p_delivery_subtotal_cents: number
          p_dropoff_address: Json
          p_idempotency_key: string
          p_included_loaded_miles: number
          p_loaded_miles: number
          p_overnight_requested: boolean
          p_payer_type: string
          p_pickup_address: Json
          p_pricing_policy_version: string
          p_proof_method: string
          p_quote_line_items: Json
          p_quote_status: string
          p_readiness_state: string
          p_recipient_email: string
          p_recipient_name: string
          p_recipient_phone: string
          p_review_reasons: Json
          p_service_level: string
          p_signature_required: boolean
          p_source: string
          p_weight_lb: number
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_create_dispatch_vehicle: {
        Args: {
          p_actor_user_id: string
          p_assigned_driver_id: string
          p_cargo_height_in: number
          p_cargo_length_in: number
          p_cargo_width_in: number
          p_enclosed: boolean
          p_has_dolly: boolean
          p_has_ramp: boolean
          p_has_tie_downs: boolean
          p_name: string
          p_payload_capacity_lb: number
          p_vehicle_class: string
          p_weather_protection: boolean
        }
        Returns: {
          active: boolean
          assigned_driver_id: string | null
          availability_state: string
          cargo_height_in: number | null
          cargo_length_in: number | null
          cargo_width_in: number | null
          created_at: string
          enclosed: boolean
          has_dolly: boolean
          has_ramp: boolean
          has_tie_downs: boolean
          id: string
          name: string
          payload_capacity_lb: number
          updated_at: string
          vehicle_class: string
          version: number
          weather_protection: boolean
        }
        SetofOptions: {
          from: "*"
          to: "couranr_dispatch_vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_create_driver_profile: {
        Args: {
          p_actor_user_id: string
          p_contact_phone: string
          p_display_name: string
          p_market: string
          p_user_id: string
        }
        Returns: {
          active: boolean
          availability_state: string
          contact_phone: string | null
          created_at: string
          display_name: string
          driver_state: string
          id: string
          market: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_create_merchant_workspace: {
        Args: {
          p_business_category: string
          p_contact_phone: string
          p_idempotency_key: string
          p_name: string
          p_owner_user_id: string
          p_payer_default: string
          p_pickup_address: Json
          p_policies_version: string
          p_slug_base: string
        }
        Returns: {
          business_account_id: string
          business_category: string
          contact_phone: string
          created_at: string
          created_by: string
          id: string
          idempotency_key: string
          payer_default: string
          pickup_address: Json
          policies_accepted_at: string
          policies_version: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "couranr_merchant_workspaces"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_create_payment_obligation: {
        Args: {
          p_business_account_id: string
          p_idempotency_key: string
          p_request_id: string
        }
        Returns: {
          amount_cents: number
          authorized_at: string | null
          business_account_id: string
          cancelled_at: string | null
          capture_requested_at: string | null
          captured_amount_cents: number | null
          captured_at: string | null
          created_at: string
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string
          payer_type: string
          payment_state: string
          pricing_policy_version: string
          provider: string
          provider_payment_intent_id: string | null
          request_id: string
          request_version: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_payment_obligations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_create_proof_upload: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_bytes: number
          p_expected_mime: string
          p_object_path: string
          p_proof_stage: string
          p_proof_type: string
          p_storage_bucket: string
          p_ttl_minutes: number
          p_upload_nonce: string
        }
        Returns: {
          assignment_id: string
          assignment_version: number
          consumed_at: string | null
          created_at: string
          delivery_id: string
          expected_bytes: number
          expected_mime: string
          expires_at: string
          finalized_at: string | null
          id: string
          issued_at: string
          issued_to_driver: string
          object_path: string
          proof_stage: string
          proof_type: string
          storage_bucket: string
          updated_at: string
          upload_nonce: string
          upload_state: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_proof_uploads"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_create_quote_version: {
        Args: {
          p_actor_user_id: string
          p_billable_loaded_miles: number
          p_business_account_id: string
          p_delivery_subtotal_cents: number
          p_expected_version: number
          p_included_loaded_miles: number
          p_pricing_policy_version: string
          p_quote_line_items: Json
          p_quote_status: string
          p_request_id: string
          p_review_reasons: Json
        }
        Returns: Database["public"]["Tables"]["couranr_delivery_requests"]["Row"]
      }
      couranr_cv_participant_kind_allowed: {
        Args: { p_conversation_kind: string; p_participant_kind: string }
        Returns: boolean
      }
      couranr_cv_visibility_allowed: {
        Args: { p_conversation_kind: string; p_visibility: string }
        Returns: boolean
      }
      couranr_deactivate_driver: {
        Args: {
          p_actor_user_id: string
          p_driver_id: string
          p_expected_version: number
        }
        Returns: {
          active: boolean
          availability_state: string
          contact_phone: string | null
          created_at: string
          display_name: string
          driver_state: string
          id: string
          market: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_decline_delivery_request: {
        Args: {
          p_actor_user_id: string
          p_business_account_id: string
          p_decline_reason: string
          p_expected_version: number
          p_internal_note: string
          p_request_id: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_driver_assignment_for: {
        Args: { p_actor_user_id: string; p_delivery_id: string }
        Returns: {
          assigned_at: string
          assigned_by: string
          assignment_state: string
          created_at: string
          delivery_id: string
          driver_id: string
          end_reason: string | null
          ended_at: string | null
          id: string
          idempotency_key: string | null
          updated_at: string
          vehicle_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_driver_completion_receipt: {
        Args: { p_actor_user_id: string }
        Returns: {
          assignment_id: string
          delivered_at: string
          delivery_id: string
          delivery_proof_complete: boolean
          pickup_proof_complete: boolean
          proof_method: string
        }[]
      }
      couranr_fail_payment_capture: {
        Args: {
          p_obligation_id: string
          p_provider_event_id: string
          p_reason: string
        }
        Returns: {
          amount_cents: number
          authorized_at: string | null
          business_account_id: string
          cancelled_at: string | null
          capture_requested_at: string | null
          captured_amount_cents: number | null
          captured_at: string | null
          created_at: string
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string
          payer_type: string
          payment_state: string
          pricing_policy_version: string
          provider: string
          provider_payment_intent_id: string | null
          request_id: string
          request_version: number
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_payment_obligations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_finalize_proof_upload: {
        Args: {
          p_accuracy_m: number
          p_actor_user_id: string
          p_actual_bytes: number
          p_actual_mime: string
          p_actual_path: string
          p_discrepancy_id: string
          p_latitude: number
          p_longitude: number
          p_metadata: Json
          p_upload_id: string
        }
        Returns: {
          actor_driver_id: string
          assignment_id: string
          byte_size: number | null
          captured_accuracy_m: number | null
          captured_latitude: number | null
          captured_longitude: number | null
          created_at: string
          delivery_id: string
          discrepancy_id: string | null
          finalized_at: string
          id: string
          metadata: Json
          mime_type: string | null
          proof_stage: string
          proof_type: string
          storage_bucket: string | null
          storage_object_path: string | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_proofs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_finish_delivered: {
        Args: {
          p_actor_user_id: string
          p_assignment_id: string
          p_command: string
          p_delivery_id: string
          p_expected_version: number
          p_metadata: Json
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_foundation_integrity: {
        Args: never
        Returns: {
          detail: Json
          entity_id: string
          issue_code: string
        }[]
      }
      couranr_help_post_message: {
        Args: {
          p_body: string
          p_idempotency_key: string
          p_token_id: string
          p_topic: string
        }
        Returns: string
      }
      couranr_help_thread: {
        Args: { p_token_id: string }
        Returns: {
          author_participant_id: string | null
          author_user_id: string | null
          authorship: string
          body: string
          conversation_id: string
          created_at: string
          id: string
          idempotency_key: string
          topic: string | null
          visibility: string
        }[]
        SetofOptions: {
          from: "*"
          to: "couranr_conversation_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      couranr_is_within_operating_hours: {
        Args: { p_at: string }
        Returns: boolean
      }
      couranr_issue_delivery_access_token: {
        Args: { p_request_id: string; p_token_hash: string; p_ttl_days: number }
        Returns: {
          audience: string
          business_account_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          request_id: string
          revoked_at: string | null
          revoked_reason: string | null
          token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_access_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_issue_handoff_code: {
        Args: {
          p_actor_user_id: string
          p_code_digest: string
          p_code_kind: string
          p_delivery_id: string
          p_expected_generation: number
          p_ttl_minutes: number
        }
        Returns: {
          code_digest: string
          code_kind: string
          code_state: string
          consumed_at: string | null
          created_at: string
          delivery_id: string
          expires_at: string
          failed_attempts: number
          generation: number
          id: string
          issued_at: string
          issued_by: string
          last_attempt_at: string | null
          locked_at: string | null
          superseded_at: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_handoff_codes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_issue_help_token: {
        Args: {
          p_delivery_id: string
          p_token_hash: string
          p_ttl_days?: number
        }
        Returns: string
      }
      couranr_issue_payment_access_token: {
        Args: {
          p_obligation_id: string
          p_request_id: string
          p_token_hash: string
          p_ttl_days: number
        }
        Returns: {
          action: string
          business_account_id: string
          created_at: string
          expires_at: string
          id: string
          last_used_at: string | null
          obligation_id: string | null
          request_id: string
          revoked_at: string | null
          revoked_reason: string | null
          token_hash: string
        }
        SetofOptions: {
          from: "*"
          to: "couranr_payment_access_tokens"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_jsonb_audit_shape_ok: {
        Args: { p_doc: Json; p_keys: string[]; p_max_len: number }
        Returns: boolean
      }
      couranr_jsonb_has_no_key: {
        Args: { p_doc: Json; p_keys: string[] }
        Returns: boolean
      }
      couranr_mark_delivery_not_ready: {
        Args: {
          p_actor_user_id: string
          p_business_account_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_mark_delivery_ready: {
        Args: {
          p_actor_user_id: string
          p_business_account_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_mark_delivery_unavailable: {
        Args: {
          p_actor_user_id: string
          p_business_account_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_mark_driver_available: {
        Args: {
          p_actor_user_id: string
          p_driver_id: string
          p_expected_version: number
        }
        Returns: {
          active: boolean
          availability_state: string
          contact_phone: string | null
          created_at: string
          display_name: string
          driver_state: string
          id: string
          market: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_mark_driver_unavailable: {
        Args: {
          p_actor_user_id: string
          p_driver_id: string
          p_expected_version: number
        }
        Returns: {
          active: boolean
          availability_state: string
          contact_phone: string | null
          created_at: string
          display_name: string
          driver_state: string
          id: string
          market: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_mark_vehicle_available: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_vehicle_id: string
        }
        Returns: {
          active: boolean
          assigned_driver_id: string | null
          availability_state: string
          cargo_height_in: number | null
          cargo_length_in: number | null
          cargo_width_in: number | null
          created_at: string
          enclosed: boolean
          has_dolly: boolean
          has_ramp: boolean
          has_tie_downs: boolean
          id: string
          name: string
          payload_capacity_lb: number
          updated_at: string
          vehicle_class: string
          version: number
          weather_protection: boolean
        }
        SetofOptions: {
          from: "*"
          to: "couranr_dispatch_vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_mark_vehicle_unavailable: {
        Args: {
          p_actor_user_id: string
          p_expected_version: number
          p_vehicle_id: string
        }
        Returns: {
          active: boolean
          assigned_driver_id: string | null
          availability_state: string
          cargo_height_in: number | null
          cargo_length_in: number | null
          cargo_width_in: number | null
          created_at: string
          enclosed: boolean
          has_dolly: boolean
          has_ramp: boolean
          has_tie_downs: boolean
          id: string
          name: string
          payload_capacity_lb: number
          updated_at: string
          vehicle_class: string
          version: number
          weather_protection: boolean
        }
        SetofOptions: {
          from: "*"
          to: "couranr_dispatch_vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_next_operating_period_start: {
        Args: { p_at: string }
        Returns: string
      }
      couranr_operating_minutes_between: {
        Args: { p_end: string; p_start: string }
        Returns: number
      }
      couranr_operating_timezone: { Args: never; Returns: string }
      couranr_redeem_delivery_access_token: {
        Args: { p_token_hash: string }
        Returns: {
          business_account_id: string
          delivery_id: string
          reason: string
          request_id: string
          request_state: string
          valid: boolean
        }[]
      }
      couranr_redeem_help_token: {
        Args: { p_token_hash: string }
        Returns: {
          out_conversation_id: string
          out_delivery_id: string
          out_token_id: string
        }[]
      }
      couranr_redeem_payment_access_token: {
        Args: { p_token_hash: string }
        Returns: {
          amount_cents: number
          obligation_id: string
          payer_type: string
          payment_state: string
          reason: string
          request_id: string
          request_state: string
          valid: boolean
        }[]
      }
      couranr_release_assignment_resources: {
        Args: { p_driver_id: string; p_vehicle_id: string }
        Returns: undefined
      }
      couranr_replace_delivery_assignment: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_driver_id: string
          p_expected_assignment_version: number
          p_idempotency_key: string
          p_reason: string
          p_vehicle_id: string
        }
        Returns: {
          assigned_at: string
          assigned_by: string
          assignment_state: string
          created_at: string
          delivery_id: string
          driver_id: string
          end_reason: string | null
          ended_at: string | null
          id: string
          idempotency_key: string | null
          updated_at: string
          vehicle_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_assignments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_report_pickup_discrepancy: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_notes: string
          p_reason: string
        }
        Returns: {
          assignment_id: string
          created_at: string
          delivery_id: string
          discrepancy_state: string
          id: string
          notes: string | null
          reason: string
          reported_at: string
          reported_by_driver_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_pickup_discrepancies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_requote_delivery_request: {
        Args: {
          p_actor_user_id: string
          p_billable_loaded_miles: number
          p_business_account_id: string
          p_delivery_subtotal_cents: number
          p_expected_version: number
          p_included_loaded_miles: number
          p_pricing_policy_version: string
          p_quote_line_items: Json
          p_request_id: string
          p_requote_reason: string
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_resolve_pickup_discrepancy_safe_to_continue: {
        Args: {
          p_actor_user_id: string
          p_discrepancy_id: string
          p_expected_version: number
          p_note: string
        }
        Returns: {
          assignment_id: string
          created_at: string
          delivery_id: string
          discrepancy_state: string
          id: string
          notes: string | null
          reason: string
          reported_at: string
          reported_by_driver_id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_pickup_discrepancies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_resolve_terminal_capture_failure: {
        Args: {
          p_amount: number
          p_currency: string
          p_failure_code?: string
          p_intent_status: string
          p_obligation_id: string
          p_payment_intent_id: string
          p_provider_event_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["couranr_payment_apply_result"]
        SetofOptions: {
          from: "*"
          to: "couranr_payment_apply_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_revoke_delivery_access_tokens: {
        Args: { p_reason: string; p_request_id: string }
        Returns: number
      }
      couranr_revoke_payment_access_tokens: {
        Args: { p_reason: string; p_request_id: string }
        Returns: number
      }
      couranr_start_route_to_dropoff: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_version: number
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_start_route_to_pickup: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_version: number
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_submit_delivery_request: {
        Args: {
          p_actor_user_id: string
          p_billable_loaded_miles: number
          p_business_account_id: string
          p_delivery_subtotal_cents: number
          p_expected_version: number
          p_included_loaded_miles: number
          p_merchant_acknowledged?: boolean
          p_pricing_policy_version: string
          p_quote_line_items: Json
          p_quote_status: string
          p_request_id: string
          p_review_reasons: Json
        }
        Returns: {
          additional_stops: number
          billable_loaded_miles: number | null
          business_account_id: string
          created_at: string
          created_by: string
          delivery_subtotal_cents: number | null
          dropoff_address: Json | null
          id: string
          idempotency_key: string
          included_loaded_miles: number | null
          loaded_miles: number | null
          normalized_request_payload: Json
          payer_type: string
          payment_due_cents: number | null
          pickup_address: Json | null
          pricing_policy_version: string | null
          proof_method: string
          quote_line_items: Json
          quote_status: string
          readiness_state: string
          recipient_email: string | null
          recipient_name: string | null
          recipient_phone: string | null
          request_state: string
          review_reasons: Json
          review_state: string
          rounding_applied: boolean
          service_area_review_state: string
          service_level: string
          signature_required: boolean
          source: string
          submitted_at: string | null
          tax_included: boolean
          updated_at: string
          version: number
          weight_lb: number | null
        }
        SetofOptions: {
          from: "*"
          to: "couranr_delivery_requests"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_submit_delivery_request_v2: {
        Args: {
          p_acknowledged?: boolean
          p_actor_user_id: string
          p_business_account_id: string
          p_expected_version: number
          p_request_id: string
        }
        Returns: Database["public"]["Tables"]["couranr_delivery_requests"]["Row"]
      }
      couranr_suspend_driver: {
        Args: {
          p_actor_user_id: string
          p_driver_id: string
          p_expected_version: number
        }
        Returns: {
          active: boolean
          availability_state: string
          contact_phone: string | null
          created_at: string
          display_name: string
          driver_state: string
          id: string
          market: string | null
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_drivers"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_unassign_delivery_before_pickup: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_expected_version: number
          p_reason: string
        }
        Returns: {
          business_account_id: string
          captured_amount_cents: number
          created_at: string
          currency: string
          dropoff_address: Json
          fulfillment_state: string
          id: string
          payment_obligation_id: string
          pickup_address: Json
          pricing_policy_version: string
          proof_method: string
          recipient: Json
          request_id: string
          request_version: number
          scheduled_pickup_end: string
          scheduled_pickup_start: string
          service_level: string
          service_plan_id: string
          shipment: Json
          signature_required: boolean
          timezone: string
          updated_at: string
          vehicle_id: string | null
          vehicle_requirement: Json
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "couranr_deliveries"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_update_dispatch_vehicle: {
        Args: {
          p_active: boolean
          p_actor_user_id: string
          p_availability_state: string
          p_expected_version: number
          p_name: string
          p_payload_capacity_lb: number
          p_vehicle_id: string
        }
        Returns: {
          active: boolean
          assigned_driver_id: string | null
          availability_state: string
          cargo_height_in: number | null
          cargo_length_in: number | null
          cargo_width_in: number | null
          created_at: string
          enclosed: boolean
          has_dolly: boolean
          has_ramp: boolean
          has_tie_downs: boolean
          id: string
          name: string
          payload_capacity_lb: number
          updated_at: string
          vehicle_class: string
          version: number
          weather_protection: boolean
        }
        SetofOptions: {
          from: "*"
          to: "couranr_dispatch_vehicles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      couranr_vehicle_class_rank: { Args: { p_class: string }; Returns: number }
      couranr_vehicle_incompatibility: {
        Args: { p_driver_id: string; p_requirement: Json; p_vehicle_id: string }
        Returns: string
      }
      couranr_verify_handoff_code: {
        Args: {
          p_actor_user_id: string
          p_code_digest: string
          p_code_kind: string
          p_delivery_id: string
        }
        Returns: Database["public"]["CompositeTypes"]["couranr_pin_attempt_result"]
        SetofOptions: {
          from: "*"
          to: "couranr_pin_attempt_result"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      is_admin:
        | { Args: never; Returns: boolean }
        | { Args: { check_user_id?: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      couranr_payment_apply_result: {
        outcome: string | null
        obligation_id: string | null
        request_id: string | null
        payment_state: string | null
        request_state: string | null
        rejected_reason: string | null
      }
      couranr_pin_attempt_result: {
        outcome: string | null
        code_kind: string | null
        generation: number | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
