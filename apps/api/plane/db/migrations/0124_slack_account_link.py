import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('db', '0123_time_entry'),
    ]

    operations = [
        migrations.CreateModel(
            name='SlackAccountLink',
            fields=[
                ('created_at', models.DateTimeField(auto_now_add=True, verbose_name='Created At')),
                ('updated_at', models.DateTimeField(auto_now=True, verbose_name='Last Modified At')),
                ('deleted_at', models.DateTimeField(blank=True, null=True, verbose_name='Deleted At')),
                ('id', models.UUIDField(db_index=True, default=uuid.uuid4, editable=False, primary_key=True, serialize=False, unique=True)),
                ('slack_team_id', models.CharField(max_length=32)),
                ('slack_user_id', models.CharField(max_length=32)),
                ('api_token', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='slack_links', to='db.apitoken')),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='%(class)s_created_by', to=settings.AUTH_USER_MODEL, verbose_name='Created By')),
                ('updated_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='%(class)s_updated_by', to=settings.AUTH_USER_MODEL, verbose_name='Last Modified By')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='slack_links', to=settings.AUTH_USER_MODEL)),
                ('workspace', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='slack_links', to='db.workspace')),
            ],
            options={
                'verbose_name': 'Slack Account Link',
                'verbose_name_plural': 'Slack Account Links',
                'db_table': 'slack_account_links',
                'ordering': ('-created_at',),
                'constraints': [models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True)), fields=('slack_team_id', 'slack_user_id'), name='slack_account_link_unique_slack_user_when_deleted_at_null')],
            },
        ),
    ]
