export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      booking_series: {
        Row: {
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          occurrences: number;
          repeat_every: string;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          occurrences: number;
          repeat_every: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          occurrences?: number;
          repeat_every?: string;
        };
        Relationships: [
          {
            foreignKeyName: "booking_series_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      bookings: {
        Row: {
          business_id: string;
          cancelled_at: string | null;
          created_at: string;
          customer_id: string;
          deposit_cents: number;
          during: unknown;
          id: string;
          notes: string | null;
          price_cents: number;
          series_id: string | null;
          service_id: string;
          source: Database["public"]["Enums"]["booking_source"];
          staff_id: string;
          status: Database["public"]["Enums"]["booking_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          cancelled_at?: string | null;
          created_at?: string;
          customer_id: string;
          deposit_cents?: number;
          during: unknown;
          id?: string;
          notes?: string | null;
          price_cents: number;
          series_id?: string | null;
          service_id: string;
          source?: Database["public"]["Enums"]["booking_source"];
          staff_id: string;
          status?: Database["public"]["Enums"]["booking_status"];
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          cancelled_at?: string | null;
          created_at?: string;
          customer_id?: string;
          deposit_cents?: number;
          during?: unknown;
          id?: string;
          notes?: string | null;
          price_cents?: number;
          series_id?: string | null;
          service_id?: string;
          source?: Database["public"]["Enums"]["booking_source"];
          staff_id?: string;
          status?: Database["public"]["Enums"]["booking_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bookings_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_customer_id_business_id_fkey";
            columns: ["customer_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "customer_stats";
            referencedColumns: ["customer_id", "business_id"];
          },
          {
            foreignKeyName: "bookings_customer_id_business_id_fkey";
            columns: ["customer_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "bookings_series_id_business_id_fkey";
            columns: ["series_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "booking_series";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "bookings_service_id_business_id_fkey";
            columns: ["service_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "bookings_staff_id_business_id_fkey";
            columns: ["staff_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      business_members: {
        Row: {
          business_id: string;
          created_at: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          created_at?: string;
          role?: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          role?: Database["public"]["Enums"]["member_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      business_type_presets: {
        Row: {
          booking_label: string;
          business_type: Database["public"]["Enums"]["business_type"];
          customer_label: string;
          default_close: string;
          default_open: string;
          label: string;
          services: NonNullable<Json>;
          staff_label: string;
          working_days: number[];
        };
        ComputedFields: never;
        Insert: {
          booking_label: string;
          business_type: Database["public"]["Enums"]["business_type"];
          customer_label: string;
          default_close: string;
          default_open: string;
          label: string;
          services?: NonNullable<Json>;
          staff_label: string;
          working_days: number[];
        };
        Update: {
          booking_label?: string;
          business_type?: Database["public"]["Enums"]["business_type"];
          customer_label?: string;
          default_close?: string;
          default_open?: string;
          label?: string;
          services?: NonNullable<Json>;
          staff_label?: string;
          working_days?: number[];
        };
        Relationships: [];
      };
      businesses: {
        Row: {
          address: string | null;
          business_type: Database["public"]["Enums"]["business_type"];
          created_at: string;
          created_by: string | null;
          currency: string;
          email: string | null;
          id: string;
          invoice_footer: string | null;
          kra_pin: string | null;
          name: string;
          phone: string | null;
          slug: string;
          timezone: string;
          updated_at: string;
          vat_rate_bp: number;
          vat_registered: boolean;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          business_type?: Database["public"]["Enums"]["business_type"];
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          email?: string | null;
          id?: string;
          invoice_footer?: string | null;
          kra_pin?: string | null;
          name: string;
          phone?: string | null;
          slug: string;
          timezone?: string;
          updated_at?: string;
          vat_rate_bp?: number;
          vat_registered?: boolean;
        };
        Update: {
          address?: string | null;
          business_type?: Database["public"]["Enums"]["business_type"];
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          email?: string | null;
          id?: string;
          invoice_footer?: string | null;
          kra_pin?: string | null;
          name?: string;
          phone?: string | null;
          slug?: string;
          timezone?: string;
          updated_at?: string;
          vat_rate_bp?: number;
          vat_registered?: boolean;
        };
        Relationships: [];
      };
      customers: {
        Row: {
          business_id: string;
          created_at: string;
          email: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone: string;
          updated_at?: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          email?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      invitations: {
        Row: {
          accepted_at: string | null;
          business_id: string;
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["member_role"];
          staff_id: string | null;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          accepted_at?: string | null;
          business_id: string;
          created_at?: string;
          email: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
          staff_id?: string | null;
          token?: string;
        };
        Update: {
          accepted_at?: string | null;
          business_id?: string;
          created_at?: string;
          email?: string;
          expires_at?: string;
          id?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["member_role"];
          staff_id?: string | null;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "invitations_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invitations_staff_id_business_id_fkey";
            columns: ["staff_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      invoice_items: {
        Row: {
          business_id: string;
          created_at: string;
          description: string;
          id: string;
          invoice_id: string;
          line_total_cents: number | null;
          quantity: number;
          sort_order: number;
          unit_price_cents: number;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          created_at?: string;
          description: string;
          id?: string;
          invoice_id: string;
          line_total_cents?: never;
          quantity?: number;
          sort_order?: number;
          unit_price_cents: number;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          description?: string;
          id?: string;
          invoice_id?: string;
          line_total_cents?: never;
          quantity?: number;
          sort_order?: number;
          unit_price_cents?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_business_id_fkey";
            columns: ["invoice_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "invoice_summaries";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "invoice_items_invoice_id_business_id_fkey";
            columns: ["invoice_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      invoices: {
        Row: {
          amount_paid_cents: number;
          balance_cents: number | null;
          booking_id: string | null;
          business_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string;
          deposit_cents: number;
          due_date: string | null;
          id: string;
          issue_date: string | null;
          issued_at: string | null;
          kind: Database["public"]["Enums"]["document_kind"];
          notes: string | null;
          number: string | null;
          number_seq: number | null;
          number_year: number | null;
          share_token: string;
          status: Database["public"]["Enums"]["invoice_status"];
          subtotal_cents: number;
          total_cents: number | null;
          updated_at: string;
          vat_cents: number;
          vat_rate_bp: number;
        };
        ComputedFields: never;
        Insert: {
          amount_paid_cents?: number;
          balance_cents?: never;
          booking_id?: string | null;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          customer_id: string;
          deposit_cents?: number;
          due_date?: string | null;
          id?: string;
          issue_date?: string | null;
          issued_at?: string | null;
          kind?: Database["public"]["Enums"]["document_kind"];
          notes?: string | null;
          number?: string | null;
          number_seq?: number | null;
          number_year?: number | null;
          share_token?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          subtotal_cents?: number;
          total_cents?: never;
          updated_at?: string;
          vat_cents?: number;
          vat_rate_bp?: number;
        };
        Update: {
          amount_paid_cents?: number;
          balance_cents?: never;
          booking_id?: string | null;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          customer_id?: string;
          deposit_cents?: number;
          due_date?: string | null;
          id?: string;
          issue_date?: string | null;
          issued_at?: string | null;
          kind?: Database["public"]["Enums"]["document_kind"];
          notes?: string | null;
          number?: string | null;
          number_seq?: number | null;
          number_year?: number | null;
          share_token?: string;
          status?: Database["public"]["Enums"]["invoice_status"];
          subtotal_cents?: number;
          total_cents?: never;
          updated_at?: string;
          vat_cents?: number;
          vat_rate_bp?: number;
        };
        Relationships: [
          {
            foreignKeyName: "invoices_booking_id_business_id_fkey";
            columns: ["booking_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "booking_details";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "invoices_booking_id_business_id_fkey";
            columns: ["booking_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "invoices_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_customer_id_business_id_fkey";
            columns: ["customer_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "customer_stats";
            referencedColumns: ["customer_id", "business_id"];
          },
          {
            foreignKeyName: "invoices_customer_id_business_id_fkey";
            columns: ["customer_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      payments: {
        Row: {
          amount_cents: number;
          booking_id: string | null;
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          invoice_id: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          mpesa_checkout_request_id: string | null;
          mpesa_merchant_request_id: string | null;
          mpesa_receipt: string | null;
          paid_at: string | null;
          phone: string | null;
          reference: string | null;
          result_code: number | null;
          result_desc: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          amount_cents: number;
          booking_id?: string | null;
          business_id: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          invoice_id?: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          mpesa_checkout_request_id?: string | null;
          mpesa_merchant_request_id?: string | null;
          mpesa_receipt?: string | null;
          paid_at?: string | null;
          phone?: string | null;
          reference?: string | null;
          result_code?: number | null;
          result_desc?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Update: {
          amount_cents?: number;
          booking_id?: string | null;
          business_id?: string;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          invoice_id?: string | null;
          method?: Database["public"]["Enums"]["payment_method"];
          mpesa_checkout_request_id?: string | null;
          mpesa_merchant_request_id?: string | null;
          mpesa_receipt?: string | null;
          paid_at?: string | null;
          phone?: string | null;
          reference?: string | null;
          result_code?: number | null;
          result_desc?: string | null;
          status?: Database["public"]["Enums"]["payment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_booking_id_business_id_fkey";
            columns: ["booking_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "booking_details";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "payments_booking_id_business_id_fkey";
            columns: ["booking_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "payments_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_invoice_id_business_id_fkey";
            columns: ["invoice_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "invoice_summaries";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "payments_invoice_id_business_id_fkey";
            columns: ["invoice_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "invoices";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      services: {
        Row: {
          active: boolean;
          buffer_minutes: number;
          business_id: string;
          created_at: string;
          deposit_cents: number;
          description: string | null;
          duration_minutes: number;
          id: string;
          name: string;
          price_cents: number;
          sort_order: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          buffer_minutes?: number;
          business_id: string;
          created_at?: string;
          deposit_cents?: number;
          description?: string | null;
          duration_minutes: number;
          id?: string;
          name: string;
          price_cents?: number;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          buffer_minutes?: number;
          business_id?: string;
          created_at?: string;
          deposit_cents?: number;
          description?: string | null;
          duration_minutes?: number;
          id?: string;
          name?: string;
          price_cents?: number;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "services_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      staff: {
        Row: {
          active: boolean;
          business_id: string;
          color: string;
          created_at: string;
          display_name: string;
          id: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          business_id: string;
          color?: string;
          created_at?: string;
          display_name: string;
          id?: string;
          user_id?: string | null;
        };
        Update: {
          active?: boolean;
          business_id?: string;
          color?: string;
          created_at?: string;
          display_name?: string;
          id?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "staff_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_breaks: {
        Row: {
          business_id: string;
          end_time: string;
          id: string;
          staff_id: string;
          start_time: string;
          weekday: number;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          end_time: string;
          id?: string;
          staff_id: string;
          start_time: string;
          weekday: number;
        };
        Update: {
          business_id?: string;
          end_time?: string;
          id?: string;
          staff_id?: string;
          start_time?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "staff_breaks_staff_id_business_id_fkey";
            columns: ["staff_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      staff_services: {
        Row: {
          business_id: string;
          service_id: string;
          staff_id: string;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          service_id: string;
          staff_id: string;
        };
        Update: {
          business_id?: string;
          service_id?: string;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "staff_services_service_id_business_id_fkey";
            columns: ["service_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "staff_services_staff_id_business_id_fkey";
            columns: ["staff_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      time_off: {
        Row: {
          business_id: string;
          created_at: string;
          during: unknown;
          id: string;
          reason: string | null;
          staff_id: string;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          created_at?: string;
          during: unknown;
          id?: string;
          reason?: string | null;
          staff_id: string;
        };
        Update: {
          business_id?: string;
          created_at?: string;
          during?: unknown;
          id?: string;
          reason?: string | null;
          staff_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "time_off_staff_id_business_id_fkey";
            columns: ["staff_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      working_hours: {
        Row: {
          business_id: string;
          end_time: string;
          id: string;
          staff_id: string;
          start_time: string;
          weekday: number;
        };
        ComputedFields: never;
        Insert: {
          business_id: string;
          end_time: string;
          id?: string;
          staff_id: string;
          start_time: string;
          weekday: number;
        };
        Update: {
          business_id?: string;
          end_time?: string;
          id?: string;
          staff_id?: string;
          start_time?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "working_hours_staff_id_business_id_fkey";
            columns: ["staff_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
    };
    Views: {
      booking_details: {
        Row: {
          business_id: string | null;
          created_at: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          deposit_cents: number | null;
          during: unknown;
          ends_at: string | null;
          id: string | null;
          notes: string | null;
          price_cents: number | null;
          series_id: string | null;
          service_id: string | null;
          service_name: string | null;
          source: Database["public"]["Enums"]["booking_source"] | null;
          staff_color: string | null;
          staff_id: string | null;
          staff_name: string | null;
          starts_at: string | null;
          status: Database["public"]["Enums"]["booking_status"] | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "bookings_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bookings_customer_id_business_id_fkey";
            columns: ["customer_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "customer_stats";
            referencedColumns: ["customer_id", "business_id"];
          },
          {
            foreignKeyName: "bookings_customer_id_business_id_fkey";
            columns: ["customer_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "bookings_series_id_business_id_fkey";
            columns: ["series_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "booking_series";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "bookings_service_id_business_id_fkey";
            columns: ["service_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "bookings_staff_id_business_id_fkey";
            columns: ["staff_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
      customer_stats: {
        Row: {
          business_id: string | null;
          cancellations: number | null;
          completed_value_cents: number | null;
          created_at: string | null;
          customer_id: string | null;
          email: string | null;
          last_visit_at: string | null;
          name: string | null;
          next_visit_at: string | null;
          no_shows: number | null;
          phone: string | null;
          upcoming: number | null;
          visits: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "customers_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
        ];
      };
      invoice_summaries: {
        Row: {
          amount_due_now_cents: number | null;
          amount_paid_cents: number | null;
          balance_cents: number | null;
          booking_id: string | null;
          business_id: string | null;
          created_at: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          days_overdue: number | null;
          deposit_cents: number | null;
          due_date: string | null;
          id: string | null;
          is_overdue: boolean | null;
          issue_date: string | null;
          kind: Database["public"]["Enums"]["document_kind"] | null;
          number: string | null;
          status: Database["public"]["Enums"]["invoice_status"] | null;
          total_cents: number | null;
        };
        ComputedFields: never;
        Relationships: [
          {
            foreignKeyName: "invoices_booking_id_business_id_fkey";
            columns: ["booking_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "booking_details";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "invoices_booking_id_business_id_fkey";
            columns: ["booking_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "bookings";
            referencedColumns: ["id", "business_id"];
          },
          {
            foreignKeyName: "invoices_business_id_fkey";
            columns: ["business_id"];
            isOneToOne: false;
            referencedRelation: "businesses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "invoices_customer_id_business_id_fkey";
            columns: ["customer_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "customer_stats";
            referencedColumns: ["customer_id", "business_id"];
          },
          {
            foreignKeyName: "invoices_customer_id_business_id_fkey";
            columns: ["customer_id", "business_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "business_id"];
          },
        ];
      };
    };
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string };
      available_slots: {
        Args: {
          p_business_id: string;
          p_day: string;
          p_service_id: string;
          p_staff_id?: string;
          p_step_minutes?: number;
        };
        Returns: {
          ends_at: string;
          staff_id: string;
          starts_at: string;
        }[];
      };
      book_public: {
        Args: {
          p_customer_email?: string;
          p_customer_name: string;
          p_customer_phone: string;
          p_notes?: string;
          p_service_id: string;
          p_slug: string;
          p_staff_id?: string;
          p_starts_at: string;
        };
        Returns: Json;
      };
      calendar_bookings: {
        Args: { p_business_id: string; p_from: string; p_to: string };
        Returns: {
          business_id: string | null;
          created_at: string | null;
          customer_id: string | null;
          customer_name: string | null;
          customer_phone: string | null;
          deposit_cents: number | null;
          during: unknown;
          ends_at: string | null;
          id: string | null;
          notes: string | null;
          price_cents: number | null;
          series_id: string | null;
          service_id: string | null;
          service_name: string | null;
          source: Database["public"]["Enums"]["booking_source"] | null;
          staff_color: string | null;
          staff_id: string | null;
          staff_name: string | null;
          starts_at: string | null;
          status: Database["public"]["Enums"]["booking_status"] | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "booking_details";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      convert_quote_to_invoice: { Args: { p_quote_id: string }; Returns: string };
      create_booking: {
        Args: {
          p_customer_id: string;
          p_notes?: string;
          p_service_id: string;
          p_staff_id: string;
          p_starts_at: string;
        };
        Returns: {
          business_id: string;
          cancelled_at: string | null;
          created_at: string;
          customer_id: string;
          deposit_cents: number;
          during: unknown;
          id: string;
          notes: string | null;
          price_cents: number;
          series_id: string | null;
          service_id: string;
          source: Database["public"]["Enums"]["booking_source"];
          staff_id: string;
          status: Database["public"]["Enums"]["booking_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "bookings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_business: {
        Args: {
          p_business_type?: Database["public"]["Enums"]["business_type"];
          p_display_name?: string;
          p_name: string;
          p_phone?: string;
          p_slug: string;
        };
        Returns: {
          address: string | null;
          business_type: Database["public"]["Enums"]["business_type"];
          created_at: string;
          created_by: string | null;
          currency: string;
          email: string | null;
          id: string;
          invoice_footer: string | null;
          kra_pin: string | null;
          name: string;
          phone: string | null;
          slug: string;
          timezone: string;
          updated_at: string;
          vat_rate_bp: number;
          vat_registered: boolean;
        };
        SetofOptions: {
          from: "*";
          to: "businesses";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_invoice_from_booking: { Args: { p_booking_id: string }; Returns: string };
      create_mpesa_payment: {
        Args: {
          p_amount_cents: number;
          p_booking_id?: string;
          p_business_id: string;
          p_checkout_request_id: string;
          p_created_by?: string;
          p_invoice_id?: string;
          p_merchant_request_id?: string;
          p_phone: string;
        };
        Returns: {
          amount_cents: number;
          booking_id: string | null;
          business_id: string;
          created_at: string;
          created_by: string | null;
          id: string;
          invoice_id: string | null;
          method: Database["public"]["Enums"]["payment_method"];
          mpesa_checkout_request_id: string | null;
          mpesa_merchant_request_id: string | null;
          mpesa_receipt: string | null;
          paid_at: string | null;
          phone: string | null;
          reference: string | null;
          result_code: number | null;
          result_desc: string | null;
          status: Database["public"]["Enums"]["payment_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "payments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      create_recurring_bookings: {
        Args: {
          p_customer_id: string;
          p_every: string;
          p_first_start: string;
          p_notes?: string;
          p_occurrences: number;
          p_service_id: string;
          p_staff_id: string;
        };
        Returns: {
          business_id: string;
          cancelled_at: string | null;
          created_at: string;
          customer_id: string;
          deposit_cents: number;
          during: unknown;
          id: string;
          notes: string | null;
          price_cents: number;
          series_id: string | null;
          service_id: string;
          source: Database["public"]["Enums"]["booking_source"];
          staff_id: string;
          status: Database["public"]["Enums"]["booking_status"];
          updated_at: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "bookings";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      decline_quote: { Args: { p_quote_id: string }; Returns: undefined };
      get_public_booking: { Args: { p_booking_id: string }; Returns: Json };
      get_public_booking_page: { Args: { p_slug: string }; Returns: Json };
      get_shared_invoice: { Args: { p_share_token: string }; Returns: Json };
      issue_invoice: {
        Args: { p_invoice_id: string };
        Returns: {
          amount_paid_cents: number;
          balance_cents: number | null;
          booking_id: string | null;
          business_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string;
          deposit_cents: number;
          due_date: string | null;
          id: string;
          issue_date: string | null;
          issued_at: string | null;
          kind: Database["public"]["Enums"]["document_kind"];
          notes: string | null;
          number: string | null;
          number_seq: number | null;
          number_year: number | null;
          share_token: string;
          status: Database["public"]["Enums"]["invoice_status"];
          subtotal_cents: number;
          total_cents: number | null;
          updated_at: string;
          vat_cents: number;
          vat_rate_bp: number;
        };
        SetofOptions: {
          from: "*";
          to: "invoices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      latest_mpesa_attempt: {
        Args: { p_booking_id?: string; p_invoice_id?: string };
        Returns: Json;
      };
      normalize_phone: { Args: { p_phone: string }; Returns: string };
      prepare_mpesa_request: {
        Args: { p_amount_cents?: number; p_booking_id?: string; p_invoice_id?: string };
        Returns: Json;
      };
      public_booking_pages: {
        Args: Record<PropertyKey, never>;
        Returns: {
          last_modified: string;
          slug: string;
        }[];
      };
      record_mpesa_callback: { Args: { p_payload: Json }; Returns: Json };
      report_busiest_hours: {
        Args: { p_business_id: string; p_from: string; p_to: string };
        Returns: {
          bookings_count: number;
          hour: number;
          rank: number;
          weekday: number;
        }[];
      };
      report_receivables_ageing: {
        Args: { p_as_of?: string; p_business_id: string };
        Returns: {
          balance_cents: number;
          bucket: string;
          invoice_count: number;
        }[];
      };
      report_repeat_customer_rate: {
        Args: { p_business_id: string; p_from: string; p_to: string };
        Returns: {
          customers_in_period: number;
          repeat_customers: number;
          repeat_rate_pct: number;
        }[];
      };
      report_revenue_trend: {
        Args: { p_business_id: string; p_from: string; p_to: string };
        Returns: {
          bookings_count: number;
          change_vs_prev_day_cents: number;
          day: string;
          moving_avg_7d_cents: number;
          revenue_cents: number;
          running_total_cents: number;
        }[];
      };
      report_staff_utilisation: {
        Args: { p_business_id: string; p_from: string; p_to: string };
        Returns: {
          available_minutes: number;
          booked_minutes: number;
          display_name: string;
          staff_id: string;
          utilisation_pct: number;
        }[];
      };
      reschedule_booking: {
        Args: { p_booking_id: string; p_staff_id?: string; p_starts_at: string };
        Returns: {
          business_id: string;
          cancelled_at: string | null;
          created_at: string;
          customer_id: string;
          deposit_cents: number;
          during: unknown;
          id: string;
          notes: string | null;
          price_cents: number;
          series_id: string | null;
          service_id: string;
          source: Database["public"]["Enums"]["booking_source"];
          staff_id: string;
          status: Database["public"]["Enums"]["booking_status"];
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "bookings";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      save_invoice_draft: {
        Args: {
          p_booking_id?: string;
          p_business_id: string;
          p_customer_id: string;
          p_deposit_cents?: number;
          p_due_date?: string;
          p_invoice_id: string;
          p_items: Json;
          p_kind: Database["public"]["Enums"]["document_kind"];
          p_notes?: string;
          p_vat_rate_bp?: number;
        };
        Returns: string;
      };
      void_invoice: {
        Args: { p_invoice_id: string };
        Returns: {
          amount_paid_cents: number;
          balance_cents: number | null;
          booking_id: string | null;
          business_id: string;
          created_at: string;
          created_by: string | null;
          currency: string;
          customer_id: string;
          deposit_cents: number;
          due_date: string | null;
          id: string;
          issue_date: string | null;
          issued_at: string | null;
          kind: Database["public"]["Enums"]["document_kind"];
          notes: string | null;
          number: string | null;
          number_seq: number | null;
          number_year: number | null;
          share_token: string;
          status: Database["public"]["Enums"]["invoice_status"];
          subtotal_cents: number;
          total_cents: number | null;
          updated_at: string;
          vat_cents: number;
          vat_rate_bp: number;
        };
        SetofOptions: {
          from: "*";
          to: "invoices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      booking_source: "public" | "dashboard";
      booking_status: "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
      business_type:
        "salon" | "tutor" | "cleaner" | "mechanic" | "clinic" | "photographer" | "general";
      document_kind: "invoice" | "quote";
      invoice_status:
        "draft" | "issued" | "partially_paid" | "paid" | "void" | "accepted" | "declined";
      member_role: "owner" | "staff";
      payment_method: "mpesa" | "cash" | "card" | "bank";
      payment_status: "pending" | "succeeded" | "failed" | "cancelled";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      booking_source: ["public", "dashboard"],
      booking_status: ["pending", "confirmed", "completed", "cancelled", "no_show"],
      business_type: ["salon", "tutor", "cleaner", "mechanic", "clinic", "photographer", "general"],
      document_kind: ["invoice", "quote"],
      invoice_status: ["draft", "issued", "partially_paid", "paid", "void", "accepted", "declined"],
      member_role: ["owner", "staff"],
      payment_method: ["mpesa", "cash", "card", "bank"],
      payment_status: ["pending", "succeeded", "failed", "cancelled"],
    },
  },
} as const;
