using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IKnowsEnemyTagAndtag
    {
        void SetEnemyTag(string newTag);
        string GetEnemyTag();
    }
}
