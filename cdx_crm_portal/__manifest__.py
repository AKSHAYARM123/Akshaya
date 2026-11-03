{
    'name': 'CRM Portal',
    'version': '19.0.1.0.0',
    'category': 'CRM',
    'summary': 'CRM Leads Portal',
    'description': """
CRM Portal
==========

Portal users can:
- View their corresponding CRM leads
- View leads in pipeline stages
- View individual lead information

Administrators can:
- View all CRM leads
- View all lead information
    """,

    'depends': [
        'base',
        'portal',
        'crm',
        'sale_crm',
        'mail',
    ],

    'data': [
        'security/ir.model.access.csv',
        'security/crm_portal_security.xml',
        'views/portal_messages_templates.xml',
        'views/portal_crm_templates.xml',
    ],

    'assets': {
        'web.assets_frontend': [
            'cdx_crm_portal/static/src/css/crm_portal.css',
            'cdx_crm_portal/static/src/css/crm_portal_messages.css',
            'cdx_crm_portal/static/src/css/crm_activity.css',
            'cdx_crm_portal/static/src/css/crm_convert_modal.css',
            'cdx_crm_portal/static/src/css/crm_lead_detail.css',
            'cdx_crm_portal/static/src/js/crm_pipeline.js',
            'cdx_crm_portal/static/src/js/crm_convert_modal.js',
            'cdx_crm_portal/static/src/js/crm_lead_detail.js',
            'cdx_crm_portal/static/src/js/crm_leads_list.js',
            'cdx_crm_portal/static/src/js/crm_portal_messages.js',
            'cdx_crm_portal/static/src/js/crm_activity.js',
        ],
    },

    'installable': True,
    'application': False,
    'license': 'LGPL-3',
}
