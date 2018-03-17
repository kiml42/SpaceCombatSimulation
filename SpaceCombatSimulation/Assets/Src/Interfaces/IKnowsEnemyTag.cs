using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IKnowsEnemyTags
    {
        /// <summary>
        /// Adds a new enemy Tag
        /// </summary>
        /// <param name="newTag"></param>
        void AddEnemyTag(string newTag);

        List<string> KnownEnemyTags { get; set; }
    }
}
