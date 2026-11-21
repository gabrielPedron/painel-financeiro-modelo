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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      account_members: {
        Row: {
          administrador: boolean
          created_at: string
          display_name: string | null
          id: string
          member_id: string
          root_owner_id: string
        }
        Insert: {
          administrador?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          member_id: string
          root_owner_id: string
        }
        Update: {
          administrador?: boolean
          created_at?: string
          display_name?: string | null
          id?: string
          member_id?: string
          root_owner_id?: string
        }
        Relationships: []
      }
      account_tax_rates: {
        Row: {
          account_id: string
          created_at: string
          id: string
          note: string | null
          rate: number
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          note?: string | null
          rate: number
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          note?: string | null
          rate?: number
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "account_tax_rates_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ajuste_preco: {
        Row: {
          account_id: string
          cheio_alterado_em: string | null
          cheio_base: number
          cheio_lido: number | null
          criado_em: string
          data_base: string
          item_id: string
          lido_em: string | null
          promocao_campanha: string | null
          promocao_fim: string | null
          promocao_preco: number | null
          promocao_tipo: string | null
        }
        Insert: {
          account_id: string
          cheio_alterado_em?: string | null
          cheio_base: number
          cheio_lido?: number | null
          criado_em?: string
          data_base: string
          item_id: string
          lido_em?: string | null
          promocao_campanha?: string | null
          promocao_fim?: string | null
          promocao_preco?: number | null
          promocao_tipo?: string | null
        }
        Update: {
          account_id?: string
          cheio_alterado_em?: string | null
          cheio_base?: number
          cheio_lido?: number | null
          criado_em?: string
          data_base?: string
          item_id?: string
          lido_em?: string | null
          promocao_campanha?: string | null
          promocao_fim?: string | null
          promocao_preco?: number | null
          promocao_tipo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ajuste_preco_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          id: string
          logo_icon_url: string | null
          logo_url: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo_icon_url?: string | null
          logo_url?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo_icon_url?: string | null
          logo_url?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_findings: {
        Row: {
          account_id: string | null
          actual: number | null
          auto_fixable: boolean
          check_code: string
          context: Json
          created_at: string
          detail: string | null
          diff: number | null
          expected: number | null
          first_seen_at: string
          id: string
          last_seen_at: string
          owner_id: string
          resolved_at: string | null
          severity: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          actual?: number | null
          auto_fixable?: boolean
          check_code: string
          context?: Json
          created_at?: string
          detail?: string | null
          diff?: number | null
          expected?: number | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          owner_id: string
          resolved_at?: string | null
          severity: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          actual?: number | null
          auto_fixable?: boolean
          check_code?: string
          context?: Json
          created_at?: string
          detail?: string | null
          diff?: number | null
          expected?: number | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          owner_id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_findings_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_subtype_map: {
        Row: {
          category: string
          conta_no_custo: boolean
          created_at: string
          em_sale_fee: boolean
          escopo: string | null
          label: string | null
          observacao: string | null
          sub_type: string
          updated_at: string
        }
        Insert: {
          category: string
          conta_no_custo?: boolean
          created_at?: string
          em_sale_fee?: boolean
          escopo?: string | null
          label?: string | null
          observacao?: string | null
          sub_type: string
          updated_at?: string
        }
        Update: {
          category?: string
          conta_no_custo?: boolean
          created_at?: string
          em_sale_fee?: boolean
          escopo?: string | null
          label?: string | null
          observacao?: string | null
          sub_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      card_invoice_items: {
        Row: {
          codigo_autorizacao: string | null
          created_at: string
          data_compra: string | null
          descricao: string
          descricao_normalizada: string | null
          expense_category_id: string | null
          expense_id: string | null
          final_cartao: string | null
          id: string
          invoice_id: string
          match_status: string
          observacao: string | null
          owner_id: string
          parcela_atual: number | null
          parcela_total: number | null
          tipo_compra: string | null
          valor: number
          valor_previsto: number | null
        }
        Insert: {
          codigo_autorizacao?: string | null
          created_at?: string
          data_compra?: string | null
          descricao: string
          descricao_normalizada?: string | null
          expense_category_id?: string | null
          expense_id?: string | null
          final_cartao?: string | null
          id?: string
          invoice_id: string
          match_status?: string
          observacao?: string | null
          owner_id: string
          parcela_atual?: number | null
          parcela_total?: number | null
          tipo_compra?: string | null
          valor: number
          valor_previsto?: number | null
        }
        Update: {
          codigo_autorizacao?: string | null
          created_at?: string
          data_compra?: string | null
          descricao?: string
          descricao_normalizada?: string | null
          expense_category_id?: string | null
          expense_id?: string | null
          final_cartao?: string | null
          id?: string
          invoice_id?: string
          match_status?: string
          observacao?: string | null
          owner_id?: string
          parcela_atual?: number | null
          parcela_total?: number | null
          tipo_compra?: string | null
          valor?: number
          valor_previsto?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "card_invoice_items_expense_category_id_fkey"
            columns: ["expense_category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_invoice_items_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "card_invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      card_invoices: {
        Row: {
          banco: string
          created_at: string
          id: string
          owner_id: string
          periodo_fim: string | null
          periodo_inicio: string | null
          referencia: string | null
          status: string
          total_fatura: number | null
          vencimento: string | null
        }
        Insert: {
          banco?: string
          created_at?: string
          id?: string
          owner_id: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          referencia?: string | null
          status?: string
          total_fatura?: number | null
          vencimento?: string | null
        }
        Update: {
          banco?: string
          created_at?: string
          id?: string
          owner_id?: string
          periodo_fim?: string | null
          periodo_inicio?: string | null
          referencia?: string | null
          status?: string
          total_fatura?: number | null
          vencimento?: string | null
        }
        Relationships: []
      }
      card_rules: {
        Row: {
          ativo: boolean
          created_at: string
          expense_category_id: string | null
          expense_id: string | null
          id: string
          match_tipo: string
          owner_id: string
          padrao: string
          valor_max: number | null
          valor_min: number | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          expense_category_id?: string | null
          expense_id?: string | null
          id?: string
          match_tipo?: string
          owner_id: string
          padrao: string
          valor_max?: number | null
          valor_min?: number | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          expense_category_id?: string | null
          expense_id?: string | null
          id?: string
          match_tipo?: string
          owner_id?: string
          padrao?: string
          valor_max?: number | null
          valor_min?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "card_rules_expense_category_id_fkey"
            columns: ["expense_category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "card_rules_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          ativo: boolean
          cnpj: string | null
          created_at: string
          id: string
          nome: string
          owner_id: string
          razao_social: string | null
          regime_tributario: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cnpj?: string | null
          created_at?: string
          id?: string
          nome: string
          owner_id: string
          razao_social?: string | null
          regime_tributario?: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cnpj?: string | null
          created_at?: string
          id?: string
          nome?: string
          owner_id?: string
          razao_social?: string | null
          regime_tributario?: string
          updated_at?: string
        }
        Relationships: []
      }
      expense_categories: {
        Row: {
          allow_subcategories: boolean
          cnpj: string | null
          created_at: string
          ecommerce_amount: number
          ecommerce_mode: string
          ecommerce_percent: number
          id: string
          kind: string
          name: string
          owner_id: string
          parent_category_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          allow_subcategories?: boolean
          cnpj?: string | null
          created_at?: string
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_percent?: number
          id?: string
          kind: string
          name: string
          owner_id: string
          parent_category_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          allow_subcategories?: boolean
          cnpj?: string | null
          created_at?: string
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_percent?: number
          id?: string
          kind?: string
          name?: string
          owner_id?: string
          parent_category_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_categories_parent_category_id_fkey"
            columns: ["parent_category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_name_rules: {
        Row: {
          category_id: string | null
          created_at: string
          expense_id: string | null
          id: string
          match_text: string
          owner_id: string
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          expense_id?: string | null
          id?: string
          match_text: string
          owner_id: string
        }
        Update: {
          category_id?: string | null
          created_at?: string
          expense_id?: string | null
          id?: string
          match_text?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_name_rules_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_name_rules_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_values: {
        Row: {
          amount: number
          created_at: string
          expense_id: string
          id: string
          month: string
          owner_id: string
          previsto: number | null
          tem_conta: boolean
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          expense_id: string
          id?: string
          month: string
          owner_id: string
          previsto?: number | null
          tem_conta?: boolean
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          expense_id?: string
          id?: string
          month?: string
          owner_id?: string
          previsto?: number | null
          tem_conta?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_values_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          category_id: string
          created_at: string
          ecommerce_amount: number
          ecommerce_mode: string
          ecommerce_override: boolean
          ecommerce_percent: number
          id: string
          name: string
          notes: string | null
          owner_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_override?: boolean
          ecommerce_percent?: number
          id?: string
          name: string
          notes?: string | null
          owner_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_override?: boolean
          ecommerce_percent?: number
          id?: string
          name?: string
          notes?: string | null
          owner_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expense_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      faturamento_externo: {
        Row: {
          canal: string
          created_at: string
          empresa_id: string
          id: string
          month: string
          owner_id: string
          updated_at: string
          valor: number
        }
        Insert: {
          canal: string
          created_at?: string
          empresa_id: string
          id?: string
          month: string
          owner_id: string
          updated_at?: string
          valor?: number
        }
        Update: {
          canal?: string
          created_at?: string
          empresa_id?: string
          id?: string
          month?: string
          owner_id?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "faturamento_externo_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      kit_components: {
        Row: {
          component_sku: string
          created_at: string
          id: string
          kit_sku: string
          owner_id: string
          quantity: number
        }
        Insert: {
          component_sku: string
          created_at?: string
          id?: string
          kit_sku: string
          owner_id: string
          quantity?: number
        }
        Update: {
          component_sku?: string
          created_at?: string
          id?: string
          kit_sku?: string
          owner_id?: string
          quantity?: number
        }
        Relationships: []
      }
      marketplace_accounts: {
        Row: {
          access_token: string | null
          access_token_id: string | null
          ads_start_date: string | null
          advertiser_id: number | null
          client_id: string | null
          client_secret: string | null
          client_secret_id: string | null
          cnpj: string | null
          created_at: string
          empresa_id: string | null
          external_nickname: string | null
          external_user_id: number | null
          id: string
          is_active: boolean
          last_sync_at: string | null
          last_sync_status: string | null
          legal_name: string | null
          nickname: string
          owner_id: string
          platform: string
          refresh_token: string | null
          refresh_token_id: string | null
          site_id: string
          status: string
          tax_regime: string | null
          token_expires_at: string | null
          trade_name: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          access_token_id?: string | null
          ads_start_date?: string | null
          advertiser_id?: number | null
          client_id?: string | null
          client_secret?: string | null
          client_secret_id?: string | null
          cnpj?: string | null
          created_at?: string
          empresa_id?: string | null
          external_nickname?: string | null
          external_user_id?: number | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_status?: string | null
          legal_name?: string | null
          nickname: string
          owner_id: string
          platform?: string
          refresh_token?: string | null
          refresh_token_id?: string | null
          site_id?: string
          status?: string
          tax_regime?: string | null
          token_expires_at?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          access_token_id?: string | null
          ads_start_date?: string | null
          advertiser_id?: number | null
          client_id?: string | null
          client_secret?: string | null
          client_secret_id?: string | null
          cnpj?: string | null
          created_at?: string
          empresa_id?: string | null
          external_nickname?: string | null
          external_user_id?: number | null
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          last_sync_status?: string | null
          legal_name?: string | null
          nickname?: string
          owner_id?: string
          platform?: string
          refresh_token?: string | null
          refresh_token_id?: string | null
          site_id?: string
          status?: string
          tax_regime?: string | null
          token_expires_at?: string | null
          trade_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_accounts_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_ads_daily: {
        Row: {
          account_id: string
          acos: number | null
          ad_group_id: number | null
          campaign_id: number | null
          campaign_name: string | null
          clicks: number
          cost: number
          cpc: number | null
          ctr: number | null
          date: string
          direct_amount: number
          direct_units: number
          id: string
          indirect_amount: number
          indirect_units: number
          item_id: string | null
          organic_units: number
          prints: number
          raw: Json | null
          synced_at: string
          title: string | null
        }
        Insert: {
          account_id: string
          acos?: number | null
          ad_group_id?: number | null
          campaign_id?: number | null
          campaign_name?: string | null
          clicks?: number
          cost?: number
          cpc?: number | null
          ctr?: number | null
          date: string
          direct_amount?: number
          direct_units?: number
          id?: string
          indirect_amount?: number
          indirect_units?: number
          item_id?: string | null
          organic_units?: number
          prints?: number
          raw?: Json | null
          synced_at?: string
          title?: string | null
        }
        Update: {
          account_id?: string
          acos?: number | null
          ad_group_id?: number | null
          campaign_id?: number | null
          campaign_name?: string | null
          clicks?: number
          cost?: number
          cpc?: number | null
          ctr?: number | null
          date?: string
          direct_amount?: number
          direct_units?: number
          id?: string
          indirect_amount?: number
          indirect_units?: number
          item_id?: string | null
          organic_units?: number
          prints?: number
          raw?: Json | null
          synced_at?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_ads_daily_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_billing_details: {
        Row: {
          account_id: string
          amount: number
          billing_group: string
          concept: string | null
          concept_type: string | null
          detail_id: string
          detail_sub_type: string | null
          detail_type: string
          document_type: string
          id: string
          item_id: string | null
          legal_document_number: string | null
          marketplace: string | null
          order_id: number | null
          period_key: string
          raw: Json | null
          shipping_id: number | null
          synced_at: string
          transaction_date: string | null
        }
        Insert: {
          account_id: string
          amount: number
          billing_group?: string
          concept?: string | null
          concept_type?: string | null
          detail_id: string
          detail_sub_type?: string | null
          detail_type: string
          document_type: string
          id?: string
          item_id?: string | null
          legal_document_number?: string | null
          marketplace?: string | null
          order_id?: number | null
          period_key: string
          raw?: Json | null
          shipping_id?: number | null
          synced_at?: string
          transaction_date?: string | null
        }
        Update: {
          account_id?: string
          amount?: number
          billing_group?: string
          concept?: string | null
          concept_type?: string | null
          detail_id?: string
          detail_sub_type?: string | null
          detail_type?: string
          document_type?: string
          id?: string
          item_id?: string | null
          legal_document_number?: string | null
          marketplace?: string | null
          order_id?: number | null
          period_key?: string
          raw?: Json | null
          shipping_id?: number | null
          synced_at?: string
          transaction_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_billing_details_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_billing_periods: {
        Row: {
          account_id: string
          amount: number
          date_from: string | null
          date_to: string | null
          id: string
          period_key: string
          period_status: string | null
          synced_at: string
          unpaid_amount: number
        }
        Insert: {
          account_id: string
          amount?: number
          date_from?: string | null
          date_to?: string | null
          id?: string
          period_key: string
          period_status?: string | null
          synced_at?: string
          unpaid_amount?: number
        }
        Update: {
          account_id?: string
          amount?: number
          date_from?: string | null
          date_to?: string | null
          id?: string
          period_key?: string
          period_status?: string | null
          synced_at?: string
          unpaid_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "ml_billing_periods_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_items: {
        Row: {
          account_id: string
          category_id: string | null
          id: string
          item_id: string
          permalink: string | null
          price: number | null
          seller_sku: string | null
          status: string | null
          synced_at: string
          thumbnail: string | null
          title: string
        }
        Insert: {
          account_id: string
          category_id?: string | null
          id?: string
          item_id: string
          permalink?: string | null
          price?: number | null
          seller_sku?: string | null
          status?: string | null
          synced_at?: string
          thumbnail?: string | null
          title: string
        }
        Update: {
          account_id?: string
          category_id?: string | null
          id?: string
          item_id?: string
          permalink?: string | null
          price?: number | null
          seller_sku?: string | null
          status?: string | null
          synced_at?: string
          thumbnail?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_order_items: {
        Row: {
          account_id: string
          created_at: string
          full_unit_price: number | null
          id: string
          item_id: string
          order_ref: string
          quantity: number
          sale_fee: number | null
          seller_sku: string | null
          title: string
          unit_price: number
        }
        Insert: {
          account_id: string
          created_at?: string
          full_unit_price?: number | null
          id?: string
          item_id: string
          order_ref: string
          quantity: number
          sale_fee?: number | null
          seller_sku?: string | null
          title: string
          unit_price: number
        }
        Update: {
          account_id?: string
          created_at?: string
          full_unit_price?: number | null
          id?: string
          item_id?: string
          order_ref?: string
          quantity?: number
          sale_fee?: number | null
          seller_sku?: string | null
          title?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "ml_order_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_order_items_order_ref_fkey"
            columns: ["order_ref"]
            isOneToOne: false
            referencedRelation: "ml_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_orders: {
        Row: {
          account_id: string
          buyer_nickname: string | null
          currency_id: string
          date_closed: string | null
          date_created: string
          id: string
          logistic_type: string | null
          order_id: number
          paid_amount: number | null
          raw: Json | null
          refunded_amount: number
          shipping_id: number | null
          status: string
          synced_at: string
          total_amount: number
        }
        Insert: {
          account_id: string
          buyer_nickname?: string | null
          currency_id?: string
          date_closed?: string | null
          date_created: string
          id?: string
          logistic_type?: string | null
          order_id: number
          paid_amount?: number | null
          raw?: Json | null
          refunded_amount?: number
          shipping_id?: number | null
          status: string
          synced_at?: string
          total_amount: number
        }
        Update: {
          account_id?: string
          buyer_nickname?: string | null
          currency_id?: string
          date_closed?: string | null
          date_created?: string
          id?: string
          logistic_type?: string | null
          order_id?: number
          paid_amount?: number | null
          raw?: Json | null
          refunded_amount?: number
          shipping_id?: number | null
          status?: string
          synced_at?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "ml_orders_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_visits_daily: {
        Row: {
          account_id: string
          date: string
          id: string
          synced_at: string
          visits: number
        }
        Insert: {
          account_id: string
          date: string
          id?: string
          synced_at?: string
          visits?: number
        }
        Update: {
          account_id?: string
          date?: string
          id?: string
          synced_at?: string
          visits?: number
        }
        Relationships: [
          {
            foreignKeyName: "ml_visits_daily_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_payments: {
        Row: {
          account_id: string
          coupon_fee: number
          date_approved: string | null
          date_created: string | null
          fee_total: number
          id: string
          installment_fee: number
          installments: number | null
          ml_fee: number
          money_release_date: string | null
          money_release_status: string | null
          mp_fee: number
          net_received_amount: number
          operation_type: string | null
          order_id: number | null
          payment_id: number
          payment_method_id: string | null
          payment_type_id: string | null
          raw: Json | null
          shipping_fee: number
          split_fee: number
          status: string | null
          status_detail: string | null
          synced_at: string
          total_paid_amount: number
          transaction_amount: number
        }
        Insert: {
          account_id: string
          coupon_fee?: number
          date_approved?: string | null
          date_created?: string | null
          fee_total?: number
          id?: string
          installment_fee?: number
          installments?: number | null
          ml_fee?: number
          money_release_date?: string | null
          money_release_status?: string | null
          mp_fee?: number
          net_received_amount?: number
          operation_type?: string | null
          order_id?: number | null
          payment_id: number
          payment_method_id?: string | null
          payment_type_id?: string | null
          raw?: Json | null
          shipping_fee?: number
          split_fee?: number
          status?: string | null
          status_detail?: string | null
          synced_at?: string
          total_paid_amount?: number
          transaction_amount?: number
        }
        Update: {
          account_id?: string
          coupon_fee?: number
          date_approved?: string | null
          date_created?: string | null
          fee_total?: number
          id?: string
          installment_fee?: number
          installments?: number | null
          ml_fee?: number
          money_release_date?: string | null
          money_release_status?: string | null
          mp_fee?: number
          net_received_amount?: number
          operation_type?: string | null
          order_id?: number | null
          payment_id?: number
          payment_method_id?: string | null
          payment_type_id?: string | null
          raw?: Json | null
          shipping_fee?: number
          split_fee?: number
          status?: string | null
          status_detail?: string | null
          synced_at?: string
          total_paid_amount?: number
          transaction_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "mp_payments_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_states: {
        Row: {
          account_id: string
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          state: string
          used_at: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          expires_at: string
          id?: string
          owner_id: string
          state: string
          used_at?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          state?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_states_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_cost_entries: {
        Row: {
          amount: number
          cost_id: string
          created_at: string
          id: string
          month: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          cost_id: string
          created_at?: string
          id?: string
          month: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          cost_id?: string
          created_at?: string
          id?: string
          month?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_cost_entries_cost_id_fkey"
            columns: ["cost_id"]
            isOneToOne: false
            referencedRelation: "operating_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_cost_items: {
        Row: {
          amount: number
          cost_id: string
          created_at: string
          id: string
          label: string
          month: string
          owner_id: string
        }
        Insert: {
          amount?: number
          cost_id: string
          created_at?: string
          id?: string
          label: string
          month: string
          owner_id: string
        }
        Update: {
          amount?: number
          cost_id?: string
          created_at?: string
          id?: string
          label?: string
          month?: string
          owner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "operating_cost_items_cost_id_fkey"
            columns: ["cost_id"]
            isOneToOne: false
            referencedRelation: "operating_costs"
            referencedColumns: ["id"]
          },
        ]
      }
      operating_costs: {
        Row: {
          amount: number | null
          category: string
          cost_type: string
          created_at: string
          ecommerce_amount: number
          ecommerce_mode: string
          ecommerce_percent: number
          end_month: string | null
          id: string
          imported_at: string | null
          is_active: boolean
          name: string
          notes: string | null
          owner_id: string
          recurrence: string
          start_month: string
          updated_at: string
        }
        Insert: {
          amount?: number | null
          category: string
          cost_type: string
          created_at?: string
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_percent?: number
          end_month?: string | null
          id?: string
          imported_at?: string | null
          is_active?: boolean
          name: string
          notes?: string | null
          owner_id: string
          recurrence: string
          start_month: string
          updated_at?: string
        }
        Update: {
          amount?: number | null
          category?: string
          cost_type?: string
          created_at?: string
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_percent?: number
          end_month?: string | null
          id?: string
          imported_at?: string | null
          is_active?: boolean
          name?: string
          notes?: string | null
          owner_id?: string
          recurrence?: string
          start_month?: string
          updated_at?: string
        }
        Relationships: []
      }
      payable_installments: {
        Row: {
          created_at: string
          id: string
          note_id: string
          numero: string | null
          owner_id: string
          pago_em: string | null
          planilha_expense_id: string | null
          planilha_lancado: boolean
          planilha_month: string | null
          planilha_valor: number | null
          status: string
          updated_at: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note_id: string
          numero?: string | null
          owner_id: string
          pago_em?: string | null
          planilha_expense_id?: string | null
          planilha_lancado?: boolean
          planilha_month?: string | null
          planilha_valor?: number | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note_id?: string
          numero?: string | null
          owner_id?: string
          pago_em?: string | null
          planilha_expense_id?: string | null
          planilha_lancado?: boolean
          planilha_month?: string | null
          planilha_valor?: number | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payable_installments_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "payable_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      payable_items: {
        Row: {
          created_at: string
          descricao: string | null
          fornecedor_sku: string | null
          frete_rateado: number
          id: string
          meu_sku: string | null
          note_id: string
          owner_id: string
          quantidade: number | null
          unidades_por_embalagem: number
          valor_total: number | null
          valor_unitario: number | null
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          fornecedor_sku?: string | null
          frete_rateado?: number
          id?: string
          meu_sku?: string | null
          note_id: string
          owner_id: string
          quantidade?: number | null
          unidades_por_embalagem?: number
          valor_total?: number | null
          valor_unitario?: number | null
        }
        Update: {
          created_at?: string
          descricao?: string | null
          fornecedor_sku?: string | null
          frete_rateado?: number
          id?: string
          meu_sku?: string | null
          note_id?: string
          owner_id?: string
          quantidade?: number | null
          unidades_por_embalagem?: number
          valor_total?: number | null
          valor_unitario?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payable_items_note_id_fkey"
            columns: ["note_id"]
            isOneToOne: false
            referencedRelation: "payable_notes"
            referencedColumns: ["id"]
          },
        ]
      }
      payable_notes: {
        Row: {
          categoria_id: string | null
          chave_nfe: string | null
          competencia_mes: string | null
          created_at: string
          data_emissao: string | null
          destino: string
          ecommerce_amount: number
          ecommerce_mode: string
          ecommerce_percent: number
          fornecedor_cnpj: string | null
          fornecedor_nome: string
          gasto_id: string | null
          id: string
          numero_nota: string | null
          observacao: string | null
          owner_id: string
          recorrencia_id: string | null
          status: string
          subcategoria_id: string | null
          tipo_conta: string
          updated_at: string
          valor_frete: number | null
          valor_outros: number | null
          valor_produtos: number | null
          valor_total: number
        }
        Insert: {
          categoria_id?: string | null
          chave_nfe?: string | null
          competencia_mes?: string | null
          created_at?: string
          data_emissao?: string | null
          destino?: string
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_percent?: number
          fornecedor_cnpj?: string | null
          fornecedor_nome: string
          gasto_id?: string | null
          id?: string
          numero_nota?: string | null
          observacao?: string | null
          owner_id: string
          recorrencia_id?: string | null
          status?: string
          subcategoria_id?: string | null
          tipo_conta?: string
          updated_at?: string
          valor_frete?: number | null
          valor_outros?: number | null
          valor_produtos?: number | null
          valor_total?: number
        }
        Update: {
          categoria_id?: string | null
          chave_nfe?: string | null
          competencia_mes?: string | null
          created_at?: string
          data_emissao?: string | null
          destino?: string
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_percent?: number
          fornecedor_cnpj?: string | null
          fornecedor_nome?: string
          gasto_id?: string | null
          id?: string
          numero_nota?: string | null
          observacao?: string | null
          owner_id?: string
          recorrencia_id?: string | null
          status?: string
          subcategoria_id?: string | null
          tipo_conta?: string
          updated_at?: string
          valor_frete?: number | null
          valor_outros?: number | null
          valor_produtos?: number | null
          valor_total?: number
        }
        Relationships: []
      }
      payable_recurrences: {
        Row: {
          ativo: boolean
          categoria_id: string | null
          created_at: string
          destino: string
          dia_vencimento: number
          ecommerce_amount: number
          ecommerce_mode: string
          ecommerce_percent: number
          gasto_id: string | null
          id: string
          nome: string
          owner_id: string
          subcategoria_id: string | null
          tipo_conta: string
          updated_at: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          categoria_id?: string | null
          created_at?: string
          destino?: string
          dia_vencimento?: number
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_percent?: number
          gasto_id?: string | null
          id?: string
          nome: string
          owner_id: string
          subcategoria_id?: string | null
          tipo_conta?: string
          updated_at?: string
          valor?: number
        }
        Update: {
          ativo?: boolean
          categoria_id?: string | null
          created_at?: string
          destino?: string
          dia_vencimento?: number
          ecommerce_amount?: number
          ecommerce_mode?: string
          ecommerce_percent?: number
          gasto_id?: string | null
          id?: string
          nome?: string
          owner_id?: string
          subcategoria_id?: string | null
          tipo_conta?: string
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      product_cost_history: {
        Row: {
          created_at: string
          data_nota: string | null
          id: string
          item_id: string | null
          note_id: string | null
          numero_nota: string | null
          origem: string
          owner_id: string
          registrado_em: string
          sku: string
          valor_unitario: number
        }
        Insert: {
          created_at?: string
          data_nota?: string | null
          id?: string
          item_id?: string | null
          note_id?: string | null
          numero_nota?: string | null
          origem?: string
          owner_id: string
          registrado_em?: string
          sku: string
          valor_unitario: number
        }
        Update: {
          created_at?: string
          data_nota?: string | null
          id?: string
          item_id?: string | null
          note_id?: string | null
          numero_nota?: string | null
          origem?: string
          owner_id?: string
          registrado_em?: string
          sku?: string
          valor_unitario?: number
        }
        Relationships: []
      }
      product_skus: {
        Row: {
          ativo: boolean
          categoria: string | null
          codigo_barras: string | null
          created_at: string
          custo_base: number | null
          custo_travado: boolean
          id: string
          is_kit: boolean
          owner_id: string
          preco_varejo: number | null
          sku: string
          titulo: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria?: string | null
          codigo_barras?: string | null
          created_at?: string
          custo_base?: number | null
          custo_travado?: boolean
          id?: string
          is_kit?: boolean
          owner_id: string
          preco_varejo?: number | null
          sku: string
          titulo?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string | null
          codigo_barras?: string | null
          created_at?: string
          custo_base?: number | null
          custo_travado?: boolean
          id?: string
          is_kit?: boolean
          owner_id?: string
          preco_varejo?: number | null
          sku?: string
          titulo?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rental_group_labels: {
        Row: {
          cnpj_raiz: string
          created_at: string
          id: string
          label: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          cnpj_raiz: string
          created_at?: string
          id?: string
          label: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          cnpj_raiz?: string
          created_at?: string
          id?: string
          label?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      rental_invoices: {
        Row: {
          cnpj: string | null
          cnpj_raiz: string | null
          created_at: string
          fatura_num: string | null
          id: string
          month: string
          municipio: string | null
          nome_fantasia: string | null
          owner_id: string
          razao_social: string | null
          talao: string | null
          uf: string | null
          updated_at: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          cnpj?: string | null
          cnpj_raiz?: string | null
          created_at?: string
          fatura_num?: string | null
          id?: string
          month: string
          municipio?: string | null
          nome_fantasia?: string | null
          owner_id: string
          razao_social?: string | null
          talao?: string | null
          uf?: string | null
          updated_at?: string
          valor: number
          vencimento?: string | null
        }
        Update: {
          cnpj?: string | null
          cnpj_raiz?: string | null
          created_at?: string
          fatura_num?: string | null
          id?: string
          month?: string
          municipio?: string | null
          nome_fantasia?: string | null
          owner_id?: string
          razao_social?: string | null
          talao?: string | null
          uf?: string | null
          updated_at?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: []
      }
      sku_item_links: {
        Row: {
          account_id: string
          created_at: string
          id: string
          item_id: string
          owner_id: string
          seller_sku: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          item_id: string
          owner_id: string
          seller_sku: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          item_id?: string
          owner_id?: string
          seller_sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "sku_item_links_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sku_translation_rules: {
        Row: {
          created_at: string
          fornecedor_sku: string
          id: string
          meu_sku: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          fornecedor_sku: string
          id?: string
          meu_sku: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          fornecedor_sku?: string
          id?: string
          meu_sku?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          account_id: string
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          job_type: string
          last_error: string | null
          owner_id: string
          priority: number
          progress_cursor: string | null
          progress_offset: number
          started_at: string | null
          status: string
          target_date: string | null
          target_key: string | null
          transient_retries: number
          verify_passes: number
        }
        Insert: {
          account_id: string
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          job_type: string
          last_error?: string | null
          owner_id: string
          priority?: number
          progress_cursor?: string | null
          progress_offset?: number
          started_at?: string | null
          status?: string
          target_date?: string | null
          target_key?: string | null
          transient_retries?: number
          verify_passes?: number
        }
        Update: {
          account_id?: string
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          job_type?: string
          last_error?: string | null
          owner_id?: string
          priority?: number
          progress_cursor?: string | null
          progress_offset?: number
          started_at?: string | null
          status?: string
          target_date?: string | null
          target_key?: string | null
          transient_retries?: number
          verify_passes?: number
        }
        Relationships: [
          {
            foreignKeyName: "sync_jobs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_logs: {
        Row: {
          account_id: string | null
          details: Json | null
          error_message: string | null
          finished_at: string | null
          id: string
          records_processed: number
          started_at: string
          status: string
          sync_type: string
        }
        Insert: {
          account_id?: string | null
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          records_processed?: number
          started_at?: string
          status?: string
          sync_type: string
        }
        Update: {
          account_id?: string | null
          details?: Json | null
          error_message?: string | null
          finished_at?: string | null
          id?: string
          records_processed?: number
          started_at?: string
          status?: string
          sync_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_logs_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_ad_alert_state: {
        Row: {
          account_id: string
          created_at: string
          id: string
          is_negative: boolean
          item_id: string
          last_alert_at: string | null
          owner_id: string
          updated_at: string
        }
        Insert: {
          account_id: string
          created_at?: string
          id?: string
          is_negative?: boolean
          item_id: string
          last_alert_at?: string | null
          owner_id: string
          updated_at?: string
        }
        Update: {
          account_id?: string
          created_at?: string
          id?: string
          is_negative?: boolean
          item_id?: string
          last_alert_at?: string | null
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      telegram_alert_log: {
        Row: {
          account_id: string | null
          alert_type: string
          attempts: number
          created_at: string
          id: string
          last_error: string | null
          message: string | null
          owner_id: string
          payload: Json
          ref_key: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          alert_type: string
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          message?: string | null
          owner_id: string
          payload?: Json
          ref_key: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          alert_type?: string
          attempts?: number
          created_at?: string
          id?: string
          last_error?: string | null
          message?: string | null
          owner_id?: string
          payload?: Json
          ref_key?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      telegram_config: {
        Row: {
          alert_anuncio_negativo: boolean
          alert_chat_id: string | null
          alert_margem_baixa: boolean
          alert_prejuizo: boolean
          alert_sem_custo_resumo: boolean
          alerts_started_at: string | null
          allowed_chat_id: string | null
          created_at: string
          id: string
          inbound_enabled: boolean
          is_active: boolean
          margem_minima_pct: number
          max_alertas_hora: number
          owner_id: string
          updated_at: string
        }
        Insert: {
          alert_anuncio_negativo?: boolean
          alert_chat_id?: string | null
          alert_margem_baixa?: boolean
          alert_prejuizo?: boolean
          alert_sem_custo_resumo?: boolean
          alerts_started_at?: string | null
          allowed_chat_id?: string | null
          created_at?: string
          id?: string
          inbound_enabled?: boolean
          is_active?: boolean
          margem_minima_pct?: number
          max_alertas_hora?: number
          owner_id: string
          updated_at?: string
        }
        Update: {
          alert_anuncio_negativo?: boolean
          alert_chat_id?: string | null
          alert_margem_baixa?: boolean
          alert_prejuizo?: boolean
          alert_sem_custo_resumo?: boolean
          alerts_started_at?: string | null
          allowed_chat_id?: string | null
          created_at?: string
          id?: string
          inbound_enabled?: boolean
          is_active?: boolean
          margem_minima_pct?: number
          max_alertas_hora?: number
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_screen_access: {
        Row: {
          created_at: string
          id: string
          member_id: string
          root_owner_id: string
          screen_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          root_owner_id: string
          screen_key: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          root_owner_id?: string
          screen_key?: string
        }
        Relationships: []
      }
    }
    Views: {
      ml_billing_norm: {
        Row: {
          account_id: string | null
          category: string | null
          conta_no_custo: boolean | null
          detail_sub_type: string | null
          detail_type: string | null
          em_sale_fee: boolean | null
          escopo: string | null
          id: string | null
          item_id: string | null
          order_id: number | null
          transaction_date: string | null
          valor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_billing_details_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_comissao_item: {
        Row: {
          account_id: string | null
          comissao: number | null
          fonte_faturamento: boolean | null
          item_id: string | null
          order_id: number | null
          order_ref: string | null
          sale_fee_total: number | null
          unidades: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ml_order_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "marketplace_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ml_order_items_order_ref_fkey"
            columns: ["order_ref"]
            isOneToOne: false
            referencedRelation: "ml_orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      card_invoice_post: {
        Args: { _invoice_id: string; _decisions: Json }
        Returns: Json
      }
      card_invoice_undo: {
        Args: { _invoice_id: string }
        Returns: undefined
      }
      ajustar_mes_recorrencia: {
        Args: {
          _competencia: string
          _novo_valor: number
          _owner: string
          _recorrencia_id: string
        }
        Returns: number
      }
      ajuste_preco_gravar_leitura: {
        Args: { _account_id: string; _leituras: Json }
        Returns: number
      }
      anuncios_margem: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          ads: number
          cmv: number
          comissao: number
          componentes_sem_custo: number
          custo_faltando: boolean
          custo_unit: number
          devolucao: number
          frete: number
          frete_rateado: number
          imposto: number
          is_kit: boolean
          item_id: string
          margem: number
          parcelamento: number
          pedidos_ok: number
          pedidos_problema: number
          permalink: string
          preco_atual: number
          receita: number
          seller_sku: string
          status: string
          thumbnail: string
          titulo: string
          unidades: number
          unidades_canceladas: number
          valor_perdido: number
          valor_produto: number
        }[]
      }
      anuncios_preco_alvo: {
        Args: {
          _account_ids: string[]
          _from: string
          _margem_alvo?: number
          _to: string
        }
        Returns: {
          account_id: string
          cheio_alterado_em: string | null
          cheio_alvo: number | null
          cheio_base: number | null
          cheio_lido: number | null
          custo_faltando: boolean
          custo_un: number | null
          data_base: string | null
          desconto_pct: number | null
          frete_comprador_un: number | null
          item_id: string
          lido_em: string | null
          margem: number
          margem_alvo: number
          margem_pct: number | null
          motivo_sem_alvo: string | null
          pct_variavel: number | null
          preco_alvo: number | null
          preco_medio: number | null
          promocao_campanha: string | null
          promocao_fim: string | null
          promocao_preco: number | null
          promocao_tipo: string | null
          receita: number
          seller_sku: string | null
          titulo: string
          unidades: number
          valor_produto: number
        }[]
      }
      atualizar_valor_recorrencia: {
        Args: {
          _a_partir_de: string
          _novo_valor: number
          _owner: string
          _recorrencia_id: string
        }
        Returns: number
      }
      audit_null_sale_fee: {
        Args: { _account_id: string; _from: string }
        Returns: number
      }
      audit_orders_without_items: {
        Args: { _account_id: string; _from: string }
        Returns: number
      }
      audit_recheck_billing: { Args: never; Returns: number }
      audit_seguranca_rpc: {
        Args: never
        Returns: {
          args: string
          funcao: string
          problema: string
          severidade: string
        }[]
      }
      audit_unclassified_subtypes: {
        Args: { _account_id: string; _from: string; _to: string }
        Returns: {
          cnt: number
          concept: string
          detail_type: string
          sub_type: string
          sum_amount: number
        }[]
      }
      backfill_item_skus: { Args: never; Returns: number }
      backfill_items_from_orders: { Args: never; Returns: number }
      billing_max_detail_id: {
        Args: { _account_id: string; _period_key: string }
        Returns: string
      }
      clear_expense_month: {
        Args: { _expense_id: string; _month: string }
        Returns: undefined
      }
      conc_caixa_futuro: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          a_liberar: number
          ate_7d: number
          de_8_a_15d: number
          liberado: number
          mais_16d: number
          proxima_data: string
          proxima_valor: number
          sem_data: number
          sem_data_qtd: number
          sem_pedido: number
          sem_pedido_qtd: number
        }[]
      }
      conc_divergencias: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          diff_tarifas: number
          ml_retido: number
          order_ids_sem_venda: number
          pedidos_cancelados: number
          receita_billing_pendente: number
          receita_cancelada: number
          receita_sem_custo: number
          sistema_tarifas: number
          tarifas_canceladas: number
          tarifas_sem_venda: number
          vendas_billing_pendente: number
          vendas_sem_custo: number
        }[]
      }
      conc_recebimentos: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          bruto: number
          date_approved: string
          fee_total: number
          installment_fee: number
          installments: number
          itens: number
          liquido: number
          ml_fee: number
          money_release_status: string
          mp_fee: number
          order_date: string
          order_id: number
          order_status: string
          order_total: number
          pagamentos_do_pedido: number
          payment_id: number
          payment_method_id: string
          payment_type_id: string
          release_date: string
          sem_data: boolean
          shipping_fee: number
          sku: string
          status: string
          title: string
        }[]
      }
      conc_recebimentos_resumo: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          a_liberar: number
          a_liberar_qtd: number
          bruto: number
          estornado: number
          estornado_qtd: number
          liberado: number
          liberado_qtd: number
          liquido: number
          proxima_data: string
          sem_data: number
          sem_data_qtd: number
          tarifas: number
          ultima_data: string
        }[]
      }
      conc_tarifas_canceladas: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          order_date: string
          order_id: number
          order_total: number
          tarifas: number
        }[]
      }
      contas_permitidas: { Args: { _ids: string[] }; Returns: string[] }
      create_categoria: {
        Args: { _kind?: string; _nome: string; _owner: string }
        Returns: string
      }
      create_empresa: {
        Args: { _cnpj: string; _nome: string; _razao: string; _regime?: string }
        Returns: string
      }
      create_fornecedor: {
        Args: { _cnpj?: string; _nome: string; _owner: string }
        Returns: string
      }
      create_gasto: {
        Args: { _categoria_id: string; _nome: string; _owner: string }
        Returns: string
      }
      custos_por_operacao: {
        Args: { _owner: string; _year: number }
        Returns: {
          category_kind: string
          category_sort: number
          ecommerce: number
          locacao: number
          month: string
          top_category_id: string
          top_category_name: string
          total: number
        }[]
      }
      dashboard_cmv: {
        Args: { _from: string; _to: string }
        Returns: {
          cmv: number
          pedidos_sem_custo: number
          receita_sem_custo: number
          unidades_sem_custo: number
        }[]
      }
      dashboard_dre_tree: {
        Args: { _from: string; _to: string }
        Returns: {
          grupo: string
          grupo_ord: number
          item: string
          item_ord: number
          secao: string
          secao_ord: number
          valor: number
        }[]
      }
      dashboard_dre_tree_op: {
        Args: { _from: string; _op: string; _to: string }
        Returns: {
          grupo: string
          grupo_ord: number
          item: string
          item_ord: number
          secao: string
          secao_ord: number
          valor: number
        }[]
      }
      dashboard_ecom_metrics: {
        Args: { _from: string; _to: string }
        Returns: {
          ads: number
          faturamento: number
          pedidos: number
          tacos_pct: number
          ticket_medio: number
        }[]
      }
      dashboard_kpis: {
        Args: { _from: string; _to: string }
        Returns: {
          a_receber_ml: number
          custos_fixos: number
          custos_variaveis: number
          entradas_locacao: number
          entradas_ml: number
          entradas_total: number
          mc: number
          mc_pct: number
          resultado: number
          saidas_gerais: number
          saidas_ml: number
          saidas_total: number
        }[]
      }
      dashboard_kpis_op: {
        Args: { _from: string; _op: string; _to: string }
        Returns: {
          a_receber: number
          cmv: number
          custos_fixos: number
          custos_variaveis: number
          entradas: number
          mc: number
          mc_pct: number
          pedidos_sem_custo: number
          receita_sem_custo: number
          resultado: number
          saidas: number
        }[]
      }
      dashboard_margens: {
        Args: { _from: string; _to: string }
        Returns: {
          custos_fixos: number
          custos_variaveis: number
          margem_contribuicao_pct: number
          margem_contribuicao_reais: number
          margem_lucro_pct: number
          margem_lucro_reais: number
          operacao: string
          receita: number
        }[]
      }
      dashboard_monthly_series: {
        Args: { _from: string; _to: string }
        Returns: {
          entradas: number
          mes: string
          resultado: number
          saidas: number
        }[]
      }
      dashboard_monthly_series_op: {
        Args: { _from: string; _op: string; _to: string }
        Returns: {
          entradas: number
          mes: string
          resultado: number
          saidas: number
        }[]
      }
      dashboard_top_clientes_locacao: {
        Args: { _from: string; _limite?: number; _to: string }
        Returns: {
          cliente: string
          cnpj_raiz: string
          faturas: number
          participacao_pct: number
          total: number
          uf: string
        }[]
      }
      dashboard_top_produtos: {
        Args: { _from: string; _limite?: number; _to: string }
        Returns: {
          participacao_pct: number
          permalink: string
          receita: number
          sku: string
          thumbnail: string
          titulo: string
          unidades: number
        }[]
      }
      delete_cost_history: { Args: { _id: string }; Returns: undefined }
      delete_faturamento_externo: { Args: { _id: string }; Returns: undefined }
      delete_sku: { Args: { _sku: string }; Returns: undefined }
      ensure_product_skus_from_ml: {
        Args: { _account_id: string }
        Returns: number
      }
      excluir_recorrencia: {
        Args: { _owner: string; _recorrencia_id: string }
        Returns: undefined
      }
      expense_sheet: {
        Args: { _owner: string; _year: number }
        Returns: {
          amount: number
          amount_ecommerce: number
          category_id: string
          category_kind: string
          category_name: string
          category_sort: number
          expense_id: string
          expense_name: string
          expense_sort: number
          month: string
        }[]
      }
      expense_sheet_previsto: {
        Args: { _owner: string; _year: number }
        Returns: {
          categoria_efetiva_id: string
          gasto_id: string
          mes: string
          valor: number
        }[]
      }
      gerar_contas_recorrencia: {
        Args: {
          _mes_inicial: string
          _meses: number
          _owner: string
          _recorrencia_id: string
        }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      is_team_owner: { Args: { _owner: string }; Returns: boolean }
      kit_cost: { Args: { _kit_sku: string; _owner: string }; Returns: number }
      kit_recipe: {
        Args: { _kit_sku: string; _owner: string }
        Returns: {
          component_sku: string
          custo_total: number
          custo_unit: number
          quantity: number
          titulo: string
        }[]
      }
      list_categorias_arvore: {
        Args: { _owner: string }
        Returns: {
          allow_subcategories: boolean
          id: string
          is_fornecedores: boolean
          name: string
          nivel: number
          parent_id: string
          parent_name: string
        }[]
      }
      list_fornecedores: {
        Args: { _owner: string }
        Returns: {
          cnpj: string
          id: string
          name: string
        }[]
      }
      list_gastos_da_subcategoria: {
        Args: { _owner: string; _subcategoria_id: string }
        Returns: {
          id: string
          name: string
        }[]
      }
      list_meses_recorrencia: {
        Args: { _owner: string; _recorrencia_id: string }
        Returns: {
          competencia_mes: string
          note_id: string
          pago_em: string
          planilha_lancado: boolean
          status: string
          valor: number
          vencimento: string
        }[]
      }
      list_recorrencias: {
        Args: { _owner: string }
        Returns: {
          ativo: boolean
          categoria_id: string
          contas_abertas: number
          contas_geradas: number
          destino: string
          dia_vencimento: number
          ecommerce_amount: number
          ecommerce_mode: string
          ecommerce_percent: number
          gasto_id: string
          id: string
          nome: string
          subcategoria_id: string
          tipo_conta: string
          valor: number
        }[]
      }
      match_installments_by_approx: {
        Args: {
          _data: string
          _owner: string
          _tol_dias?: number
          _tol_percent?: number
          _valor: number
        }
        Returns: {
          categoria_id: string
          destino: string
          diff_dias: number
          diff_valor: number
          fornecedor_nome: string
          gasto_id: string
          installment_id: string
          note_id: string
          numero_nota: string
          subcategoria_id: string
          tipo_conta: string
          valor: number
          vencimento: string
        }[]
      }
      match_payable_item: {
        Args: { _item_id: string; _meu_sku: string; _owner: string }
        Returns: number
      }
      ml_ads_periodo: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          ads_ancora: number
          ads_diario: number
          ads_faturado: number
          ads_nao_atribuido: number
          cobertura_ok: boolean
          dias_com_dado: number
          dias_esperados: number
          fator: number
        }[]
      }
      ml_available_dates: {
        Args: { _account_ids: string[] }
        Returns: {
          dia: string
        }[]
      }
      ml_cmv: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          cmv: number
          receita_com_custo: number
          receita_total: number
        }[]
      }
      ml_commission_breakdown: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          amount: number
          label: string
        }[]
      }
      ml_cost_trends: {
        Args: { _account_ids: string[]; _months?: number }
        Returns: {
          account_id: string
          avg_pct_of_revenue_first: number
          avg_pct_of_revenue_last: number
          metric: string
          months_rising: number
          pct_change: number
        }[]
      }
      ml_custos_competencia: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          ads: number
          comissao: number
          custo_ml: number
          estorno: number
          frete: number
          full_periodo: number
          outros: number
        }[]
      }
      ml_custos_competencia_mes: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          ads: number
          comissao: number
          custo_ml: number
          estorno: number
          frete: number
          full_periodo: number
          mes: string
          outros: number
        }[]
      }
      ml_daily_series: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          ads: number
          commissions: number
          costs_total: number
          day: string
          fulfillment: number
          installment: number
          net: number
          revenue: number
          shipping: number
          tax: number
        }[]
      }
      ml_data_health: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          ads_days_present: number
          billing_count: number
          last_sync_at: string
          missing_ads_days: string[]
          missing_visits_days: string[]
          orders_count: number
          period_days: number
          visits_days_present: number
        }[]
      }
      ml_fulfillment_breakdown: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          amount: number
          label: string
          sub_type: string
        }[]
      }
      ml_metrics: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          ads: number
          bonifications: number
          cancelled_value: number
          commissions: number
          fulfillment: number
          installment: number
          orders_cancelled: number
          orders_count: number
          orders_refunded: number
          other: number
          partial_refunds: number
          refunds: number
          revenue: number
          revenue_gross: number
          revenue_lost: number
          shipping: number
          tax: number
          units_sold: number
          visits: number
        }[]
      }
      ml_receita_competencia_mes: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          mes: string
          pedidos: number
          receita: number
        }[]
      }
      mp_a_receber: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          ate_7d: number
          de_8_a_15d: number
          mais_16d: number
          total_pending: number
        }[]
      }
      mp_divergencias: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          descricao: string
          detalhe: Json
          order_date: string
          order_id: number
          tipo: string
          valor_divergencia: number
        }[]
      }
      mp_divergencias_resumo: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          quantidade: number
          tipo: string
          valor_total: number
        }[]
      }
      mp_reconciliation: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          account_id: string
          ads_parcial: boolean
          ads_rateado: number
          cmv: number
          cmv_missing: boolean
          coupon_fee: number
          fee_cobranca: number
          fee_cobranca_origem: string
          fee_comissao: number
          fee_comissao_origem: string
          fee_frete: number
          fee_frete_origem: string
          fee_outros: number
          fee_parcelamento: number
          fee_parcelamento_origem: string
          fees_billing_missing: boolean
          fees_billing_total: number
          fees_fallback: boolean
          has_rejected: boolean
          imposto: number
          imposto_missing: boolean
          installment_fee: number
          match_status: string
          ml_commission: number
          ml_fee: number
          mp_fee: number
          mp_fees: number
          mp_gross: number
          mp_net: number
          mp_paid_by_buyer: number
          order_date: string
          order_id: number
          order_status: string
          order_total: number
          payment_count: number
          receita: number
          receita_produto: number
          refunded_amount: number
          release_date: string
          release_status: string
          resultado: number
          resultado_pct: number
          shipping_fee: number
          sku: string
          split_fee: number
          tax_rate: number
          title: string
          units: number
        }[]
      }
      mp_reconciliation_summary: {
        Args: { _account_ids: string[]; _from: string; _to: string }
        Returns: {
          avg_fee_pct: number
          orders_count: number
          orders_matched: number
          orders_sem_aliquota: number
          orders_sem_billing: number
          orders_sem_custo: number
          orders_unmatched: number
          receita_sem_custo: number
          total_ads_atribuido: number
          total_ads_billing: number
          total_ads_nao_atribuido: number
          total_ads_periodo: number
          total_cmv: number
          total_coupon: number
          total_fee_cobranca: number
          total_fee_comissao: number
          total_fee_frete: number
          total_fee_outros: number
          total_fee_parcelamento: number
          total_fees_billing: number
          total_imposto: number
          total_installment: number
          total_mp_fees: number
          total_mp_gross: number
          total_mp_net: number
          total_order_value: number
          total_pending: number
          total_receita: number
          total_released: number
          total_resultado: number
          total_shipping: number
          total_split: number
        }[]
      }
      my_screens: {
        Args: never
        Returns: {
          screen_key: string
        }[]
      }
      normalize_desc: { Args: { _texto: string }; Returns: string }
      operating_costs_matrix: {
        Args: { _from: string; _owner: string; _to: string }
        Returns: {
          amount_ecommerce: number
          amount_total: number
          category: string
          cost_id: string
          month: string
          name: string
        }[]
      }
      operating_costs_month: {
        Args: { _month: string; _owner: string }
        Returns: {
          amount_ecommerce: number
          amount_total: number
          category: string
          cost_type: string
          ecommerce_amount: number
          ecommerce_mode: string
          ecommerce_percent: number
          id: string
          name: string
          recurrence: string
        }[]
      }
      operating_costs_summary: {
        Args: { _from: string; _owner: string; _to: string }
        Returns: {
          month: string
          total_all: number
          total_ecommerce: number
          total_fixed: number
          total_variable: number
        }[]
      }
      owns_account: { Args: { _account_id: string }; Returns: boolean }
      pay_installment_to_planilha: {
        Args: {
          _expense_id: string
          _installment_id: string
          _owner: string
          _pago_em: string
          _valor_pago?: number
        }
        Returns: undefined
      }
      payable_notes_split: {
        Args: {
          _cnpj?: string
          _fornecedor?: string
          _numero?: string
          _owner: string
          _produto?: string
          _status_pag?: string
        }
        Returns: {
          chave_nfe: string
          competencia_mes: string
          created_at: string
          data_emissao: string
          destino: string
          ecommerce_amount: number
          ecommerce_mode: string
          ecommerce_percent: number
          fornecedor_cnpj: string
          fornecedor_nome: string
          id: string
          numero_nota: string
          parcelas_pagas: number
          parcelas_total: number
          parte_ecommerce: number
          parte_locacao: number
          recorrencia_id: string
          status: string
          valor_frete: number
          valor_outros: number
          valor_produtos: number
          valor_total: number
        }[]
      }
      payable_resumo: {
        Args: { _op?: string; _owner: string }
        Returns: {
          hoje_qtd: number
          hoje_valor: number
          mes_qtd: number
          mes_valor: number
          pago_mes_qtd: number
          pago_mes_valor: number
          semana_qtd: number
          semana_valor: number
          vencido_qtd: number
          vencido_valor: number
        }[]
      }
      product_catalog: {
        Args: { _busca?: string; _owner: string; _tipo?: string }
        Returns: {
          ativo: boolean
          categoria: string
          componentes: number
          custo_efetivo: number
          id: string
          is_kit: boolean
          sku: string
          titulo: string
        }[]
      }
      purge_old_order_payloads: { Args: never; Returns: number }
      purge_old_sync_records: { Args: never; Returns: Json }
      rebuild_tax_rate_periods: {
        Args: { _account_id: string }
        Returns: undefined
      }
      recompute_sku_cost: {
        Args: { _owner: string; _sku: string }
        Returns: number
      }
      rental_by_city: {
        Args: { _month?: number; _owner: string; _year: number }
        Returns: {
          faturas: number
          municipio: string
          total: number
          uf: string
        }[]
      }
      rental_invoices_grouped: {
        Args: { _month?: number; _owner: string; _year: number }
        Returns: {
          cnpj_raiz: string
          faturas: number
          grupo_label: string
          total: number
        }[]
      }
      rental_monthly_total: {
        Args: { _owner: string; _year: number }
        Returns: {
          faturas: number
          month: string
          total: number
        }[]
      }
      reopen_installment: {
        Args: { _installment_id: string; _owner: string }
        Returns: undefined
      }
      resolve_name_rule: {
        Args: { _owner: string; _text: string }
        Returns: {
          category_id: string
          expense_id: string
          matched_text: string
        }[]
      }
      set_expense_range: {
        Args: {
          _amount: number
          _expense_id: string
          _from_month: string
          _to_month: string
        }
        Returns: number
      }
      set_faturamento_externo: {
        Args: {
          _canal: string
          _empresa_id: string
          _month: string
          _valor: number
        }
        Returns: undefined
      }
      set_manual_sku_cost: {
        Args: { _owner: string; _sku: string; _valor: number }
        Returns: number
      }
      set_sku_cost_travado: {
        Args: { _owner: string; _sku: string; _travar: boolean; _valor: number }
        Returns: number
      }
      sku_cost_history: {
        Args: { _owner: string; _sku: string }
        Returns: {
          data_nota: string
          id: string
          numero_nota: string
          origem: string
          registrado_em: string
          valor_unitario: number
        }[]
      }
      sku_custo_unit: {
        Args: never
        Returns: {
          custo_unit: number
          faltando_cnt: number
          sku: string
        }[]
      }
      sku_delete_impact: {
        Args: { _sku: string }
        Returns: {
          historico: number
          kits: string[]
          receita: number
          unidades: number
          vendas: number
          vinculos: number
        }[]
      }
      team_app_settings: {
        Args: never
        Returns: {
          logo_icon_url: string
          logo_url: string
        }[]
      }
      team_owner: { Args: never; Returns: string }
      team_users: {
        Args: never
        Returns: {
          display_name: string
          email: string
          is_admin: boolean
          member_id: string
        }[]
      }
      telegram_ad_candidates: {
        Args: { _dias?: number; _owner_id: string }
        Returns: {
          account_id: string
          account_nickname: string
          ads: number
          cmv: number
          custo_faltando: boolean
          item_id: string
          margem: number
          margem_pct: number
          receita: number
          seller_sku: string
          titulo: string
        }[]
      }
      telegram_sale_candidates: {
        Args: { _limit: number; _owner_id: string; _since: string }
        Returns: {
          account_id: string
          account_nickname: string
          cmv: number
          cmv_missing: boolean
          imposto: number
          liquido: number
          margem: number
          margem_pct: number
          order_date: string
          order_id: number
          receita: number
          sku: string
          title: string
          units: number
        }[]
      }
      tornar_conta_recorrente: {
        Args: {
          _dia_vencimento: number
          _meses: number
          _note_id: string
          _owner: string
        }
        Returns: string
      }
      unaccent: { Args: { "": string }; Returns: string }
      update_cost_history: {
        Args: { _data: string; _id: string; _valor: number }
        Returns: undefined
      }
      vault_get_secret: { Args: { _id: string }; Returns: string }
      vault_set_secret: {
        Args: { _existing_id?: string; _name: string; _secret: string }
        Returns: string
      }
      vencimentos_do_dia: {
        Args: { _dia: string; _op?: string; _owner: string }
        Returns: {
          atrasada: boolean
          categoria_efetiva_id: string
          categoria_id: string
          destino: string
          fornecedor_nome: string
          gasto_id: string
          installment_id: string
          note_id: string
          numero_nota: string
          numero_parcela: string
          pago_em: string
          planilha_lancado: boolean
          recorrencia_id: string
          status: string
          subcategoria_id: string
          tipo_conta: string
          valor: number
          vencimento: string
        }[]
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
  public: {
    Enums: {},
  },
} as const
