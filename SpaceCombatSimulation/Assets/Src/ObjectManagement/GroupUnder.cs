using Assets.Src.ObjectManagement;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class GroupUnder : MonoBehaviour
{
    public static Dictionary<string, GameObject> Groups = new Dictionary<string, GameObject>();
    
    public string GroupName = "Projectiles";

    // Use this for initialization
    void Start ()
	{
        GameObject group = null;
        if (Groups.ContainsKey(GroupName))
        {
            group = Groups[GroupName];
            if (group == null)
            {
                //The group exists but is invalid, so should be removed and recreated.
                group = null;
                Groups.Remove(GroupName);
            }
        }
        if (group == null)
        {
            group = new GameObject(GroupName);
            Groups.Add(GroupName, group);
        }
		transform.SetParent(group.transform);
	}
	
}
