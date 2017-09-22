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
        GameObject group;
        if (!Groups.ContainsKey(GroupName))
        {
            group = new GameObject(GroupName);
            Groups.Add(GroupName, group);
        } else
        {
            group = Groups[GroupName];
        }
		transform.SetParent(group.transform);
	}
	
}
