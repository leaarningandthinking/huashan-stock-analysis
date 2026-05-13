# Skills

后端默认从 `skills/huashan-lungu-v2/references/masters.md` 读取大师人设与方法论。

开源仓库不提交本地绝对路径软链。你可以任选一种方式准备 skill 内容：

```bash
# 方式一：复制目录
mkdir -p skills
cp -R /path/to/huashan-lungu-v2 skills/huashan-lungu-v2

# 方式二：创建软链
ln -s /path/to/huashan-lungu-v2 skills/huashan-lungu-v2
```

如果你计划把 skill 也开源，建议把它作为 Git submodule 或单独仓库维护。
