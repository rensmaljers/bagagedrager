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
    PostgrestVersion: "14.4"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _app_config: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      competition_participants: {
        Row: {
          competition_id: number
          has_paid: boolean
          paid_at: string | null
          user_id: string
        }
        Insert: {
          competition_id: number
          has_paid?: boolean
          paid_at?: string | null
          user_id: string
        }
        Update: {
          competition_id?: number
          has_paid?: boolean
          paid_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_participants_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          color: string | null
          competition_type: string
          country_flag: string | null
          created_at: string
          entry_fee: number | null
          id: number
          is_active: boolean
          is_one_day: boolean
          last_synced_at: string | null
          logo_url: string | null
          name: string
          pcs_url: string | null
          scoring_mode: string
          slug: string
          year: number
        }
        Insert: {
          color?: string | null
          competition_type: string
          country_flag?: string | null
          created_at?: string
          entry_fee?: number | null
          id?: number
          is_active?: boolean
          is_one_day?: boolean
          last_synced_at?: string | null
          logo_url?: string | null
          name: string
          pcs_url?: string | null
          scoring_mode?: string
          slug: string
          year: number
        }
        Update: {
          color?: string | null
          competition_type?: string
          country_flag?: string | null
          created_at?: string
          entry_fee?: number | null
          id?: number
          is_active?: boolean
          is_one_day?: boolean
          last_synced_at?: string | null
          logo_url?: string | null
          name?: string
          pcs_url?: string | null
          scoring_mode?: string
          slug?: string
          year?: number
        }
        Relationships: []
      }
      global_riders: {
        Row: {
          date_of_birth: string | null
          height_m: number | null
          id: number
          name: string | null
          nationality: string | null
          pcs_slug: string
          photo_url: string | null
          specialty_climber: number | null
          specialty_gc: number | null
          specialty_hills: number | null
          specialty_one_day: number | null
          specialty_sprint: number | null
          specialty_tt: number | null
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          date_of_birth?: string | null
          height_m?: number | null
          id?: number
          name?: string | null
          nationality?: string | null
          pcs_slug: string
          photo_url?: string | null
          specialty_climber?: number | null
          specialty_gc?: number | null
          specialty_hills?: number | null
          specialty_one_day?: number | null
          specialty_sprint?: number | null
          specialty_tt?: number | null
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          date_of_birth?: string | null
          height_m?: number | null
          id?: number
          name?: string | null
          nationality?: string | null
          pcs_slug?: string
          photo_url?: string | null
          specialty_climber?: number | null
          specialty_gc?: number | null
          specialty_hills?: number | null
          specialty_one_day?: number | null
          specialty_sprint?: number | null
          specialty_tt?: number | null
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: []
      }
      picks: {
        Row: {
          id: number
          is_late: boolean
          is_random: boolean
          rider_id: number
          stage_id: number
          submitted_at: string
          user_id: string
        }
        Insert: {
          id?: number
          is_late?: boolean
          is_random?: boolean
          rider_id: number
          stage_id: number
          submitted_at?: string
          user_id: string
        }
        Update: {
          id?: number
          is_late?: boolean
          is_random?: boolean
          rider_id?: number
          stage_id?: number
          submitted_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "picks_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          cycling_hero: string | null
          display_name: string
          email: string | null
          email_reminders: boolean
          favorite_team: string | null
          id: string
          is_active: boolean
          is_admin: boolean
          is_ai: boolean
          last_seen_at: string | null
          motto: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          cycling_hero?: string | null
          display_name: string
          email?: string | null
          email_reminders?: boolean
          favorite_team?: string | null
          id: string
          is_active?: boolean
          is_admin?: boolean
          is_ai?: boolean
          last_seen_at?: string | null
          motto?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          cycling_hero?: string | null
          display_name?: string
          email?: string | null
          email_reminders?: boolean
          favorite_team?: string | null
          id?: string
          is_active?: boolean
          is_admin?: boolean
          is_ai?: boolean
          last_seen_at?: string | null
          motto?: string | null
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth_key: string
          created_at: string | null
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth_key: string
          created_at?: string | null
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth_key?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      riders: {
        Row: {
          bib_number: number
          competition_id: number | null
          date_of_birth: string | null
          dnf: boolean
          global_rider_id: number | null
          height_m: number | null
          id: number
          name: string
          nationality: string | null
          pcs_slug: string | null
          photo_url: string | null
          specialty_climber: number | null
          specialty_gc: number | null
          specialty_hills: number | null
          specialty_one_day: number | null
          specialty_refreshed_at: string | null
          specialty_sprint: number | null
          specialty_tt: number | null
          team: string
          weight_kg: number | null
        }
        Insert: {
          bib_number: number
          competition_id?: number | null
          date_of_birth?: string | null
          dnf?: boolean
          global_rider_id?: number | null
          height_m?: number | null
          id?: number
          name: string
          nationality?: string | null
          pcs_slug?: string | null
          photo_url?: string | null
          specialty_climber?: number | null
          specialty_gc?: number | null
          specialty_hills?: number | null
          specialty_one_day?: number | null
          specialty_refreshed_at?: string | null
          specialty_sprint?: number | null
          specialty_tt?: number | null
          team: string
          weight_kg?: number | null
        }
        Update: {
          bib_number?: number
          competition_id?: number | null
          date_of_birth?: string | null
          dnf?: boolean
          global_rider_id?: number | null
          height_m?: number | null
          id?: number
          name?: string
          nationality?: string | null
          pcs_slug?: string | null
          photo_url?: string | null
          specialty_climber?: number | null
          specialty_gc?: number | null
          specialty_hills?: number | null
          specialty_one_day?: number | null
          specialty_refreshed_at?: string | null
          specialty_sprint?: number | null
          specialty_tt?: number | null
          team?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "riders_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "riders_global_rider_id_fkey"
            columns: ["global_rider_id"]
            isOneToOne: false
            referencedRelation: "global_riders"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_results: {
        Row: {
          bonification_seconds: number
          dnf: boolean
          finish_position: number | null
          game_points: number
          id: number
          manually_edited: boolean | null
          mountain_points: number
          points: number
          rider_id: number
          stage_id: number
          time_seconds: number
        }
        Insert: {
          bonification_seconds?: number
          dnf?: boolean
          finish_position?: number | null
          game_points?: number
          id?: number
          manually_edited?: boolean | null
          mountain_points?: number
          points?: number
          rider_id: number
          stage_id: number
          time_seconds: number
        }
        Update: {
          bonification_seconds?: number
          dnf?: boolean
          finish_position?: number | null
          game_points?: number
          id?: number
          manually_edited?: boolean | null
          mountain_points?: number
          points?: number
          rider_id?: number
          stage_id?: number
          time_seconds?: number
        }
        Relationships: [
          {
            foreignKeyName: "stage_results_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_results_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_riders: {
        Row: {
          rider_id: number
          stage_id: number
        }
        Insert: {
          rider_id: number
          stage_id: number
        }
        Update: {
          rider_id?: number
          stage_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "stage_riders_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stage_riders_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
        ]
      }
      stages: {
        Row: {
          arrival: string | null
          avg_speed_winner: string | null
          avg_temperature: string | null
          classification: string | null
          competition_id: number | null
          date: string
          deadline: string
          departure: string | null
          distance_km: number | null
          email_sent: boolean
          estimated_end_time: string | null
          id: number
          interactive_map_url: string | null
          locked: boolean
          name: string
          official_profile_image_url: string | null
          parcours_type: string | null
          pcs_url: string | null
          profile_image_url: string | null
          profile_score: number | null
          race_category: string | null
          rad_assigned: boolean
          reminder_sent: boolean
          results_notified: boolean
          route_map_url: string | null
          stage_number: number
          stage_type: string
          start_time: string | null
          startlist_quality_score: number | null
          vertical_meters: number | null
          winner_name: string | null
          winner_time_seconds: number | null
        }
        Insert: {
          arrival?: string | null
          avg_speed_winner?: string | null
          avg_temperature?: string | null
          classification?: string | null
          competition_id?: number | null
          date: string
          deadline: string
          departure?: string | null
          distance_km?: number | null
          email_sent?: boolean
          estimated_end_time?: string | null
          id?: number
          interactive_map_url?: string | null
          locked?: boolean
          name: string
          official_profile_image_url?: string | null
          parcours_type?: string | null
          pcs_url?: string | null
          profile_image_url?: string | null
          profile_score?: number | null
          race_category?: string | null
          rad_assigned?: boolean
          reminder_sent?: boolean
          results_notified?: boolean
          route_map_url?: string | null
          stage_number: number
          stage_type?: string
          start_time?: string | null
          startlist_quality_score?: number | null
          vertical_meters?: number | null
          winner_name?: string | null
          winner_time_seconds?: number | null
        }
        Update: {
          arrival?: string | null
          avg_speed_winner?: string | null
          avg_temperature?: string | null
          classification?: string | null
          competition_id?: number | null
          date?: string
          deadline?: string
          departure?: string | null
          distance_km?: number | null
          email_sent?: boolean
          estimated_end_time?: string | null
          id?: number
          interactive_map_url?: string | null
          locked?: boolean
          name?: string
          official_profile_image_url?: string | null
          parcours_type?: string | null
          pcs_url?: string | null
          profile_image_url?: string | null
          profile_score?: number | null
          race_category?: string | null
          rad_assigned?: boolean
          reminder_sent?: boolean
          results_notified?: boolean
          route_map_url?: string | null
          stage_number?: number
          stage_type?: string
          start_time?: string | null
          startlist_quality_score?: number | null
          vertical_meters?: number | null
          winner_name?: string | null
          winner_time_seconds?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "stages_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      team_shirts: {
        Row: {
          shirt_url: string
          team_name: string
          updated_at: string
        }
        Insert: {
          shirt_url: string
          team_name: string
          updated_at?: string
        }
        Update: {
          shirt_url?: string
          team_name?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      general_classification: {
        Row: {
          competition_id: number | null
          display_name: string | null
          scoring_mode: string | null
          stages_played: number | null
          total_bonification: number | null
          total_combativity_points: number | null
          total_game_points: number | null
          total_mountain_points: number | null
          total_points: number | null
          total_time: number | null
          total_time_no_bonif: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "stages_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      stage_picks_public: {
        Row: {
          bib_number: number | null
          bonification: number | null
          competition_id: number | null
          deadline: string | null
          display_name: string | null
          dnf: boolean | null
          dnf_penalty_gap: number | null
          effective_game_points: number | null
          effective_mountain_points: number | null
          effective_points: number | null
          finish_position: number | null
          game_points: number | null
          is_late: boolean | null
          is_random: boolean | null
          locked: boolean | null
          mountain_points: number | null
          num_pickers: number | null
          points: number | null
          rider_id: number | null
          rider_name: string | null
          rider_team: string | null
          scoring_mode: string | null
          stage_id: number | null
          stage_number: number | null
          time_gap: number | null
          time_seconds: number | null
          user_id: string | null
          winner_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "picks_rider_id_fkey"
            columns: ["rider_id"]
            isOneToOne: false
            referencedRelation: "riders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "picks_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stages_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_confirm_email: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      admin_delete_pick: {
        Args: { p_stage_id: number; p_user_id: string }
        Returns: Json
      }
      admin_delete_player: { Args: { p_user_id: string }; Returns: Json }
      admin_save_results: {
        Args: { p_manual?: boolean; p_results: Json; p_stage_id: number }
        Returns: Json
      }
      admin_upsert_pick: {
        Args: {
          p_is_late?: boolean
          p_rider_id: number
          p_stage_id: number
          p_user_id: string
        }
        Returns: Json
      }
      admin_users_with_status: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          email_confirmed_at: string
          id: string
          is_active: boolean
          is_admin: boolean
          last_seen_at: string
          last_sign_in_at: string
        }[]
      }
      assign_random_riders: { Args: { p_stage_id: number }; Returns: Json }
      bonification_seconds: { Args: { pos: number }; Returns: number }
      calculate_game_points: {
        Args: { p_stage_id: number }
        Returns: undefined
      }
      delete_own_account: { Args: never; Returns: undefined }
      get_cron_secret: { Args: never; Returns: string }
      position_to_game_points: { Args: { pos: number }; Returns: number }
      sharing_multiplier: { Args: { num_pickers: number }; Returns: number }
      submit_pick: {
        Args: { p_rider_id: number; p_stage_id: number }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
