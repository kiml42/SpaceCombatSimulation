using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IKnowsEnemyTags
    {
        /// <summary>
        /// Sets the enemy tag
        /// </summary>
        /// <param name="newTag"></param>
        void AddEnemyTag(string newTag);

        /// <summary>
        /// sets all the enemy tags
        /// </summary>
        /// <param name="allEnemyTags"></param>
        void SetEnemyTags(List<string> allEnemyTags);

        /// <summary>
        /// Retrieves the list of enemy tags
        /// </summary>
        /// <returns></returns>
        List<string> GetEnemyTags();
    }
}
