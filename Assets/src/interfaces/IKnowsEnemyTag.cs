using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;

namespace Assets.Src.Interfaces
{
    public interface IKnowsEnemyTagAndtag
    {
        /// <summary>
        /// Sets the enemy tag
        /// </summary>
        /// <param name="newTag"></param>
        void AddEnemyTag(string newTag);

        /// <summary>
        /// retrieves the first enemy tag
        /// </summary>
        /// <returns></returns>
        string GetFirstEnemyTag();

        /// <summary>
        /// sets all the enemy tags
        /// </summary>
        /// <param name="allEnemyTags"></param>
        void SetEnemyTags(IEnumerable<string> allEnemyTags);

        /// <summary>
        /// Retrieves the list of enemy tags
        /// </summary>
        /// <returns></returns>
        IEnumerable<string> GetEnemyTags();
    }
}
